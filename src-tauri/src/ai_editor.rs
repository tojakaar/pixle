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

const SYSTEM_PROMPT: &str = r#"You are a photo editing assistant for Pixle.
You adjust non-destructive slider parameters only. You never modify, generate, describe as binary, or return image data.

Given the user's instruction and the current EditParameters, return the full updated EditParameters as a single JSON object.

Rules:
- Respond with JSON only. No markdown, no commentary.
- Include every key exactly once: exposure, contrast, highlights, shadows, temperature, tint, saturation.
- Values must be finite numbers within these ranges:
  - exposure: -2 to 2 (EV stops)
  - contrast: -100 to 100
  - highlights: -100 to 100 (negative recovers/blown highlights)
  - shadows: -100 to 100 (positive lifts shadows)
  - temperature: -100 to 100 (negative cooler, positive warmer)
  - tint: -100 to 100 (negative green, positive magenta)
  - saturation: -100 to 100
- Apply a moderate adjustment relative to the current values unless the user asks to reset.
- If the instruction is unrelated to photo adjustments, return the current parameters unchanged.
"#;

/// Interpret a natural-language edit prompt via an OpenAI-compatible chat API.
///
/// Credentials stay on the Rust side (`OPENAI_API_KEY` and optional
/// `OPENAI_BASE_URL` / `OPENAI_MODEL`). Nothing image-related is sent.
#[tauri::command]
pub async fn edit_from_prompt(
    prompt: String,
    current_parameters: EditParameters,
) -> Result<EditParameters, String> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err("Prompt must not be empty.".to_string());
    }

    let api_key =
        std::env::var("OPENAI_API_KEY").map_err(|_| "OPENAI_API_KEY is not set.".to_string())?;
    if api_key.trim().is_empty() {
        return Err("OPENAI_API_KEY is empty.".to_string());
    }

    let base_url = std::env::var("OPENAI_BASE_URL")
        .unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
    let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string());

    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let user_message = format!(
        "Current EditParameters JSON:\n{}\n\nUser instruction:\n{}",
        serde_json::to_string_pretty(&current_parameters)
            .map_err(|e| format!("Failed to serialize current parameters: {e}"))?,
        trimmed
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

    validate_edit_parameters(&value)
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

fn validate_edit_parameters(value: &Value) -> Result<EditParameters, String> {
    let obj = value
        .as_object()
        .ok_or_else(|| "EditParameters JSON must be an object.".to_string())?;

    // Reject unexpected payload shapes (e.g. image blobs) before applying.
    const REQUIRED: [&str; 7] = [
        "exposure",
        "contrast",
        "highlights",
        "shadows",
        "temperature",
        "tint",
        "saturation",
    ];

    for key in REQUIRED {
        if !obj.contains_key(key) {
            return Err(format!("Missing required field `{key}`."));
        }
    }

    for key in obj.keys() {
        if !REQUIRED.contains(&key.as_str()) {
            return Err(format!("Unexpected field `{key}` in EditParameters."));
        }
    }

    Ok(EditParameters {
        exposure: read_number(obj, "exposure", -2.0, 2.0)?,
        contrast: read_number(obj, "contrast", -100.0, 100.0)?,
        highlights: read_number(obj, "highlights", -100.0, 100.0)?,
        shadows: read_number(obj, "shadows", -100.0, 100.0)?,
        temperature: read_number(obj, "temperature", -100.0, 100.0)?,
        tint: read_number(obj, "tint", -100.0, 100.0)?,
        saturation: read_number(obj, "saturation", -100.0, 100.0)?,
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
        let parsed = validate_edit_parameters(&value).unwrap();
        assert_eq!(parsed.exposure, 0.4);
        assert_eq!(parsed.highlights, -30.0);
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
        let err = validate_edit_parameters(&value).unwrap_err();
        assert!(err.contains("Unexpected field"));
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
        let parsed = validate_edit_parameters(&value).unwrap();
        assert_eq!(parsed.exposure, 2.0);
        assert_eq!(parsed.contrast, -100.0);
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
        let next = edit_from_prompt("make it brighter".into(), current)
            .await
            .expect("live AI edit should succeed");
        assert!(next.exposure > 0.0);
    }
}
