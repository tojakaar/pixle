use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Mirrors the frontend `EditParameters` object. The model may only return these
/// numeric fields — never image data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditParameters {
    pub exposure: f64,
    pub contrast: f64,
    pub highlights: f64,
    pub shadows: f64,
    pub temperature: f64,
    pub tint: f64,
    pub saturation: f64,
}

/// Compact local image-analysis metadata from the frontend.
/// Used only as LLM prompt context — never as model output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAnalysis {
    pub width: u32,
    pub height: u32,
    pub brightness_histogram: Vec<f64>,
    pub average_colour_temperature_kelvin: f64,
    pub colour_temperature_label: String,
    pub dominant_colours: Vec<DominantColour>,
    pub highlight_clipping_percent: f64,
    pub shadow_clipping_percent: f64,
    pub faces: Option<Vec<DetectedFace>>,
    pub face_detection_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DominantColour {
    pub hex: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub coverage_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedFace {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

const SYSTEM_PROMPT: &str = r#"You are an experienced professional Adobe Lightroom photo editor working inside Pixle.
You think in photographic intent, not keyword matching. You never modify, generate, describe as binary, or return image pixels.

You receive:
1. ImageAnalysis — local metadata (histogram, colour temperature, dominant colours, highlight/shadow clipping, dimensions, faces when available). Use it as your light-table read of the file.
2. Current EditParameters — the active, non-destructive baseline. Adjustments are incremental from these values.
3. The user's instruction — interpret the aesthetic or technical goal.

Return one JSON object only (no markdown, no commentary outside JSON).

## Output schema
Required numeric EditParameters (include every key exactly once):
- exposure: -2 to 2 (EV stops)
- contrast: -100 to 100
- highlights: -100 to 100 (negative recovers/protects bright areas)
- shadows: -100 to 100 (positive opens shadow detail)
- temperature: -100 to 100 (negative cooler / blue; positive warmer / amber)
- tint: -100 to 100 (negative green; positive magenta)
- saturation: -100 to 100

Optional:
- edit_summary: a short plain-language note (one sentence, ≤120 characters) explaining the intended adjustment. This is explanatory only — it is never applied to pixels.

Do not return any other keys (no image data, histograms, analysis fields, or presets).

## Editing principles
- Read the request as photographic intent (mood, story, print goal), not literal keywords.
- Always consult ImageAnalysis before deciding. Examples: high highlightClippingPercent → pull highlights / ease exposure; high shadowClippingPercent → lift shadows carefully; warm/cool Kelvin and colourTemperatureLabel → inform temperature/tint; dominantColours → guide saturation and white balance; faces present → protect natural skin tones.
- Make coordinated multi-parameter moves. Exposure, contrast, highlights, shadows, temperature, tint, and saturation interact — change them as a set, not in isolation.
- Prefer moderate, printable adjustments unless the user asks for a strong look or a reset.
- Avoid clipping highlights further; when already clipped, prioritise recovery.
- Avoid crushing shadow detail; keep texture in the lows unless a crushed-black look is clearly requested.
- When faces are detected (or the request is a portrait): keep skin believable — restrain saturation and extreme temperature/tint swings; bias toward a natural portrait balance.
- Style directions are aesthetic goals, not fixed presets. Translate them into tasteful parameter combinations informed by this specific image's analysis. Supported directions include (non-exhaustive): cinematic, film look, documentary, moody, warm sunset, editorial, natural portrait, vintage.
- If the instruction is unrelated to photo editing, return the current parameters unchanged (edit_summary may say so).
"#;

/// Result of an AI edit: slider parameters plus an optional human-readable summary.
/// Only `parameters` are applied to the image.
#[derive(Debug, Clone, Serialize)]
pub struct EditFromPromptResult {
    #[serde(flatten)]
    pub parameters: EditParameters,
    /// Optional model explanation; never used as an image input.
    #[serde(rename = "edit_summary", skip_serializing_if = "Option::is_none")]
    pub edit_summary: Option<String>,
}

/// Interpret a natural-language edit prompt via an OpenAI-compatible chat API.
///
/// Credentials stay on the Rust side (`OPENAI_API_KEY` and optional
/// `OPENAI_BASE_URL` / `OPENAI_MODEL`). Image understanding is text metadata only.
#[tauri::command]
pub async fn edit_from_prompt(
    prompt: String,
    current_parameters: EditParameters,
    image_analysis: ImageAnalysis,
) -> Result<EditFromPromptResult, String> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err("Prompt must not be empty.".to_string());
    }

    let api_key = std::env::var("OPENAI_API_KEY").map_err(|_| {
        "OPENAI_API_KEY is not set. Copy `.env.example` to `.env` in the project root (not `.env.example`) and put your key there, then restart the app.".to_string()
    })?;
    if api_key.trim().is_empty() {
        return Err("OPENAI_API_KEY is empty in `.env`.".to_string());
    }
    // Ignore placeholder values left over from `.env.example`.
    if api_key.contains("your-key-here") || api_key == "sk-your-key-here" {
        return Err(
            "OPENAI_API_KEY still looks like the placeholder. Set your real key in `.env` (gitignored), not `.env.example`."
                .to_string(),
        );
    }

    let base_url = std::env::var("OPENAI_BASE_URL")
        .unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
    let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string());

    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let analysis_json = serde_json::to_string_pretty(&image_analysis)
        .map_err(|e| format!("Failed to serialize image analysis: {e}"))?;
    let params_json = serde_json::to_string_pretty(&current_parameters)
        .map_err(|e| format!("Failed to serialize current parameters: {e}"))?;

    let user_message = format!(
        "ImageAnalysis JSON (local metadata only — not an image):\n{analysis_json}\n\n\
         Current EditParameters JSON:\n{params_json}\n\n\
         User instruction:\n{trimmed}"
    );

    let body = json!({
        "model": model,
        "temperature": 0.2,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": user_message }
        ]
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .post(&endpoint)
        .header(AUTHORIZATION, format!("Bearer {api_key}"))
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API request failed: {e}"))?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read API response: {e}"))?;

    if !status.is_success() {
        return Err(format!(
            "API returned {status}: {}",
            truncate_for_error(&response_text)
        ));
    }

    let completion: ChatCompletionResponse = serde_json::from_str(&response_text).map_err(|e| {
        format!(
            "Invalid API response envelope: {e}. Body: {}",
            truncate_for_error(&response_text)
        )
    })?;

    let content = completion
        .choices
        .first()
        .and_then(|choice| choice.message.content.as_ref())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "API returned no message content.".to_string())?;

    let json_text = extract_json_object(content)?;
    let value: Value = serde_json::from_str(&json_text).map_err(|e| {
        format!(
            "Model did not return valid JSON: {e}. Content: {}",
            truncate_for_error(content)
        )
    })?;

    parse_edit_response(&value)
}

fn extract_json_object(content: &str) -> Result<String, String> {
    let trimmed = content.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Ok(trimmed.to_string());
    }

    // Tolerate accidental markdown fences from less strict OpenAI-compatible hosts.
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            if start < end {
                return Ok(trimmed[start..=end].to_string());
            }
        }
    }

    Err(format!(
        "Model response was not a JSON object: {}",
        truncate_for_error(trimmed)
    ))
}

fn parse_edit_response(value: &Value) -> Result<EditFromPromptResult, String> {
    let obj = value
        .as_object()
        .ok_or_else(|| "EditParameters JSON must be an object.".to_string())?;

    // Reject unexpected payload shapes (e.g. image blobs) before applying.
    // `edit_summary` is the only optional non-parameter field allowed.
    const REQUIRED: [&str; 7] = [
        "exposure",
        "contrast",
        "highlights",
        "shadows",
        "temperature",
        "tint",
        "saturation",
    ];
    const OPTIONAL: [&str; 1] = ["edit_summary"];

    for key in REQUIRED {
        if !obj.contains_key(key) {
            return Err(format!("Missing required field `{key}`."));
        }
    }

    for key in obj.keys() {
        let allowed = REQUIRED.contains(&key.as_str()) || OPTIONAL.contains(&key.as_str());
        if !allowed {
            return Err(format!("Unexpected field `{key}` in EditParameters."));
        }
    }

    let edit_summary = match obj.get("edit_summary") {
        None => None,
        Some(Value::Null) => None,
        Some(Value::String(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                // Keep summaries short for the UI status line.
                let truncated: String = trimmed.chars().take(160).collect();
                Some(truncated)
            }
        }
        Some(_) => {
            return Err("Field `edit_summary` must be a string when present.".to_string());
        }
    };

    Ok(EditFromPromptResult {
        parameters: EditParameters {
            exposure: read_number(obj, "exposure", -2.0, 2.0)?,
            contrast: read_number(obj, "contrast", -100.0, 100.0)?,
            highlights: read_number(obj, "highlights", -100.0, 100.0)?,
            shadows: read_number(obj, "shadows", -100.0, 100.0)?,
            temperature: read_number(obj, "temperature", -100.0, 100.0)?,
            tint: read_number(obj, "tint", -100.0, 100.0)?,
            saturation: read_number(obj, "saturation", -100.0, 100.0)?,
        },
        edit_summary,
    })
}

fn read_number(
    obj: &serde_json::Map<String, Value>,
    key: &str,
    min: f64,
    max: f64,
) -> Result<f64, String> {
    let value = obj
        .get(key)
        .ok_or_else(|| format!("Missing required field `{key}`."))?;

    let number = match value {
        Value::Number(n) => n
            .as_f64()
            .ok_or_else(|| format!("Field `{key}` must be a finite number."))?,
        _ => {
            return Err(format!("Field `{key}` must be a number."));
        }
    };

    if !number.is_finite() {
        return Err(format!("Field `{key}` must be a finite number."));
    }

    Ok(number.clamp(min, max))
}

fn truncate_for_error(text: &str) -> String {
    const LIMIT: usize = 240;
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= LIMIT {
        return compact;
    }
    let truncated: String = compact.chars().take(LIMIT).collect();
    format!("{truncated}…")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_analysis() -> ImageAnalysis {
        ImageAnalysis {
            width: 100,
            height: 80,
            brightness_histogram: vec![3.0; 32],
            average_colour_temperature_kelvin: 5600.0,
            colour_temperature_label: "neutral daylight".into(),
            dominant_colours: vec![DominantColour {
                hex: "#808080".into(),
                r: 128,
                g: 128,
                b: 128,
                coverage_percent: 40.0,
            }],
            highlight_clipping_percent: 1.5,
            shadow_clipping_percent: 2.0,
            faces: None,
            face_detection_available: false,
        }
    }

    #[test]
    fn accepts_valid_parameters() {
        let value = json!({
            "exposure": 0.4,
            "contrast": 25,
            "highlights": -30,
            "shadows": 10,
            "temperature": 20,
            "tint": -5,
            "saturation": 15
        });
        let parsed = parse_edit_response(&value).unwrap();
        assert_eq!(parsed.parameters.exposure, 0.4);
        assert_eq!(parsed.parameters.highlights, -30.0);
        assert!(parsed.edit_summary.is_none());
    }

    #[test]
    fn accepts_optional_edit_summary() {
        let value = json!({
            "exposure": 0.2,
            "contrast": 10,
            "highlights": -20,
            "shadows": 15,
            "temperature": 12,
            "tint": 0,
            "saturation": -5,
            "edit_summary": "  Warm cinematic grade; protected highlights.  "
        });
        let parsed = parse_edit_response(&value).unwrap();
        assert_eq!(parsed.parameters.exposure, 0.2);
        assert_eq!(
            parsed.edit_summary.as_deref(),
            Some("Warm cinematic grade; protected highlights.")
        );
    }

    #[test]
    fn rejects_non_string_edit_summary() {
        let value = json!({
            "exposure": 0.0,
            "contrast": 0.0,
            "highlights": 0.0,
            "shadows": 0.0,
            "temperature": 0.0,
            "tint": 0.0,
            "saturation": 0.0,
            "edit_summary": 123
        });
        let err = parse_edit_response(&value).unwrap_err();
        assert!(err.contains("edit_summary"));
    }

    #[test]
    fn rejects_unexpected_fields() {
        let value = json!({
            "exposure": 0.0,
            "contrast": 0.0,
            "highlights": 0.0,
            "shadows": 0.0,
            "temperature": 0.0,
            "tint": 0.0,
            "saturation": 0.0,
            "imageBase64": "abc"
        });
        let err = parse_edit_response(&value).unwrap_err();
        assert!(err.contains("Unexpected field"));
    }

    #[test]
    fn rejects_missing_fields() {
        let value = json!({
            "exposure": 0.0,
            "contrast": 0.0
        });
        let err = parse_edit_response(&value).unwrap_err();
        assert!(err.contains("Missing required field"));
    }

    #[test]
    fn rejects_non_numeric_fields() {
        let value = json!({
            "exposure": "bright",
            "contrast": 0.0,
            "highlights": 0.0,
            "shadows": 0.0,
            "temperature": 0.0,
            "tint": 0.0,
            "saturation": 0.0
        });
        let err = parse_edit_response(&value).unwrap_err();
        assert!(err.contains("must be a number"));
    }

    #[test]
    fn clamps_out_of_range_values() {
        let value = json!({
            "exposure": 9.0,
            "contrast": -500,
            "highlights": 0,
            "shadows": 0,
            "temperature": 0,
            "tint": 0,
            "saturation": 0
        });
        let parsed = parse_edit_response(&value).unwrap();
        assert_eq!(parsed.parameters.exposure, 2.0);
        assert_eq!(parsed.parameters.contrast, -100.0);
    }

    #[test]
    fn image_analysis_serializes_without_pixels() {
        let json = serde_json::to_string(&sample_analysis()).unwrap();
        assert!(json.contains("brightnessHistogram"));
        assert!(json.contains("averageColourTemperatureKelvin"));
        assert!(!json.contains("imageBase64"));
        assert!(!json.contains("pixels"));
    }

    #[tokio::test]
    async fn openapi_compatible_roundtrip_against_env_endpoint() {
        // Opt-in smoke test: OPENAI_API_KEY + OPENAI_BASE_URL must be set
        // (e.g. a local mock). Skipped in default CI runs.
        if std::env::var("PIXLE_LIVE_AI_TEST").ok().as_deref() != Some("1") {
            return;
        }

        let current = EditParameters {
            exposure: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            temperature: 0.0,
            tint: 0.0,
            saturation: 0.0,
        };
        let next = edit_from_prompt("make it brighter".into(), current, sample_analysis())
            .await
            .expect("live AI edit should succeed");
        assert!(next.parameters.exposure > 0.0);
    }
}
