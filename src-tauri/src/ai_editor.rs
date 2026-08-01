use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// Per-colour HSL band — mirrors frontend `HslBand`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HslBand {
    pub hue: f64,
    pub saturation: f64,
    pub luminance: f64,
}

/// Nested HSL adjustments for eight overlapping hue bands.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HslAdjustments {
    pub red: HslBand,
    pub orange: HslBand,
    pub yellow: HslBand,
    pub green: HslBand,
    pub aqua: HslBand,
    pub blue: HslBand,
    pub purple: HslBand,
    pub magenta: HslBand,
}

/// Mirrors the frontend `EditParameters` object. The model may only return these
/// fields — never image data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditParameters {
    pub exposure: f64,
    pub contrast: f64,
    pub highlights: f64,
    pub shadows: f64,
    pub whites: f64,
    pub blacks: f64,
    pub fade: f64,
    pub temperature: f64,
    pub tint: f64,
    pub saturation: f64,
    pub vibrance: f64,
    pub grain_amount: f64,
    pub grain_size: f64,
    pub grain_roughness: f64,
    pub grain_color: f64,
    pub clarity: f64,
    pub sharpening: f64,
    pub luminance_noise_reduction: f64,
    pub chroma_noise_reduction: f64,
    pub vignette_amount: f64,
    pub vignette_midpoint: f64,
    pub vignette_feather: f64,
    pub hsl: HslAdjustments,
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

#[derive(Debug, Deserialize)]
struct AnthropicMessageResponse {
    content: Vec<AnthropicContentBlock>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiGenerateContentResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    parts: Option<Vec<GeminiPart>>,
}

#[derive(Debug, Deserialize)]
struct GeminiPart {
    text: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LlmProvider {
    Gemini,
    OpenAi,
    Anthropic,
}

const SYSTEM_PROMPT: &str = r#"You are an experienced professional photo editor working inside Pixle.
You think in photographic intent, not keyword matching. You never modify, generate, describe as binary, or return image pixels.
You never expose chain-of-thought. Return structured EditParameters JSON only.

You receive:
1. ImageAnalysis — local metadata (histogram, colour temperature, dominant colours, highlight/shadow clipping, dimensions, faces when available). Use it as your light-table read of the file.
2. Current EditParameters — the active, non-destructive baseline. Adjustments are incremental from these values.
3. The user's instruction — interpret the aesthetic or technical goal.

Return one JSON object only (no markdown, no commentary outside JSON).

## Output schema
Include every key exactly once.

Basic tone:
- exposure: -2 to 2 (EV stops)
- contrast: -100 to 100
- highlights: -100 to 100 (negative recovers/protects bright areas / highlight rolloff)
- shadows: -100 to 100 (positive opens shadow detail)
- whites: -100 to 100 (extreme highlight tip)
- blacks: -100 to 100 (extreme shadow tip; negative crushes, positive lifts)
- fade: 0 to 100 (lifted blacks / faded film)

Global colour:
- temperature: -100 to 100 (negative cooler / blue; positive warmer / amber)
- tint: -100 to 100 (negative green; positive magenta)
- saturation: -100 to 100 (linear global saturation — affects all colours evenly)
- vibrance: -100 to 100 (smart saturation — boosts muted colours, protects already-saturated colours and skin)

Film texture:
- grainAmount: 0 to 100
- grainSize: 0 to 100 (low = fine grain; high = coarse grain)
- grainRoughness: 0 to 100 (soft ↔ crunchy)
- grainColor: 0 to 100 (0 = monochrome grain; 100 = coloured grain)

Detail:
- clarity: -100 to 100 (midtone local contrast)
- sharpening: 0 to 100
- luminanceNoiseReduction: 0 to 100
- chromaNoiseReduction: 0 to 100

Vignette:
- vignetteAmount: -100 to 100 (negative darkens edges)
- vignetteMidpoint: 0 to 100
- vignetteFeather: 0 to 100

Per-colour HSL (overlapping soft hue bands — no hard boundaries):
- hsl: object with keys red, orange, yellow, green, aqua, blue, purple, magenta
- each colour object must include: hue (-100…100), saturation (-100…100), luminance (-100…100)

Examples of intent → parameters:
- "make the blues lighter" → raise hsl.blue.luminance
- "mute the greens" → lower hsl.green.saturation (and maybe green luminance slightly)
- "shift reds slightly toward orange" → small positive hsl.red.hue
- "desaturate yellows" → negative hsl.yellow.saturation
- "make skin slightly brighter" → raise hsl.orange.luminance (and mild red luminance); keep vibrance/saturation restrained
- "fine grain" → grainAmount moderate, grainSize low, grainRoughness moderate, grainColor near 0
- "coarse grain" → higher grainSize / roughness
- "monochrome grain" → grainColor 0
- "faded film" → raise fade, lift blacks/shadows, ease contrast, often lower saturation
- "muted colours" → negative vibrance and/or saturation; selective HSL saturation cuts
- "lifted blacks" → positive fade and/or positive blacks
- "highlight rolloff" → negative highlights (and often negative whites)
- "vibrance" vs "saturation": vibrance for lively but natural colour; saturation for even global chroma push/pull

Optional:
- edit_summary: a short glance phrase for the UI (about 3–7 words, roughly ≤45 characters). Not a full sentence. Never start with "Applied". No trailing ellipsis. Examples: "Warm Kodak Gold", "Muted greens", "Soft summer film", "Fine monochrome grain", "Warm skin, cool shadows". Explanatory only — never applied to pixels. Detailed rationale belongs nowhere in the JSON.

Do not return any other keys (no image data, histograms, analysis fields, presets, or reasoning fields).

## Editing principles
- Read the request as photographic intent (mood, story, print goal), not literal keywords.
- Always consult ImageAnalysis before deciding.
- Make coordinated multi-parameter moves; parameters interact.
- Prefer moderate, printable adjustments unless the user asks for a strong look or a reset.
- Avoid clipping highlights further; when already clipped, prioritise recovery (negative highlights/whites).
- Avoid crushing shadow detail unless clearly requested.
- When faces are detected (or the request is a portrait): keep skin believable — prefer vibrance over saturation, use orange/red HSL carefully, restrain extreme temperature/tint.
- Style directions (cinematic, film look, documentary, moody, warm sunset, editorial, natural portrait, vintage, faded summer, cool editorial) are aesthetic goals — translate into tasteful parameter combinations for this specific image.
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

/// Interpret a natural-language edit prompt via Gemini, Anthropic, or OpenAI-compatible APIs.
///
/// Credentials stay on the Rust side. Prefer Google AI Studio (`GEMINI_API_KEY` /
/// `GOOGLE_API_KEY`), or use `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. Image understanding
/// is text metadata only.
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

    let analysis_json = serde_json::to_string_pretty(&image_analysis)
        .map_err(|e| format!("Failed to serialize image analysis: {e}"))?;
    let params_json = serde_json::to_string_pretty(&current_parameters)
        .map_err(|e| format!("Failed to serialize current parameters: {e}"))?;

    let user_message = format!(
        "ImageAnalysis JSON (local metadata only — not an image):\n{analysis_json}\n\n\
         Current EditParameters JSON:\n{params_json}\n\n\
         User instruction:\n{trimmed}"
    );

    let provider = resolve_provider()?;
    let content = match provider {
        LlmProvider::Gemini => call_gemini(&user_message).await?,
        LlmProvider::Anthropic => call_anthropic(&user_message).await?,
        LlmProvider::OpenAi => call_openai_compatible(&user_message).await?,
    };

    let json_text = extract_json_object(&content)?;
    let value: Value = serde_json::from_str(&json_text).map_err(|e| {
        format!(
            "Model did not return valid JSON: {e}. Content: {}",
            truncate_for_error(&content)
        )
    })?;

    parse_edit_response(&value)
}

fn resolve_provider() -> Result<LlmProvider, String> {
    let explicit = std::env::var("LLM_PROVIDER")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    match explicit.as_str() {
        "gemini" | "google" => Ok(LlmProvider::Gemini),
        "anthropic" | "claude" => Ok(LlmProvider::Anthropic),
        "openai" => Ok(LlmProvider::OpenAi),
        "" => {
            if gemini_key_usable() {
                Ok(LlmProvider::Gemini)
            } else if env_key_usable("ANTHROPIC_API_KEY") {
                Ok(LlmProvider::Anthropic)
            } else if env_key_usable("OPENAI_API_KEY") {
                Ok(LlmProvider::OpenAi)
            } else {
                Err(
                    "No LLM API key found. Set GEMINI_API_KEY or GOOGLE_API_KEY (Google AI Studio), ANTHROPIC_API_KEY, or OPENAI_API_KEY in `.env`, then restart the app."
                        .to_string(),
                )
            }
        }
        other => Err(format!(
            "Unknown LLM_PROVIDER `{other}`. Use `gemini`, `anthropic`, or `openai`."
        )),
    }
}

fn gemini_key_usable() -> bool {
    env_key_usable("GEMINI_API_KEY") || env_key_usable("GOOGLE_API_KEY")
}

fn require_gemini_key() -> Result<String, String> {
    if env_key_usable("GEMINI_API_KEY") {
        return require_env_key("GEMINI_API_KEY");
    }
    if env_key_usable("GOOGLE_API_KEY") {
        return require_env_key("GOOGLE_API_KEY");
    }
    Err(
        "GEMINI_API_KEY / GOOGLE_API_KEY is not set. Add your Google AI Studio key to project-root `.env` and restart the app."
            .to_string(),
    )
}

fn env_key_usable(name: &str) -> bool {
    match std::env::var(name) {
        Ok(value) => {
            let trimmed = value.trim();
            !trimmed.is_empty() && !looks_like_placeholder(trimmed)
        }
        Err(_) => false,
    }
}

fn require_env_key(name: &str) -> Result<String, String> {
    let value = std::env::var(name).map_err(|_| {
        format!(
            "{name} is not set. Add it to project-root `.env` (not `.env.example`) and restart the app."
        )
    })?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{name} is empty in `.env`."));
    }
    if looks_like_placeholder(trimmed) {
        return Err(format!(
            "{name} still looks like the placeholder. Set your real key in `.env`."
        ));
    }
    Ok(trimmed.to_string())
}

fn looks_like_placeholder(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("your-key-here")
        || lower.contains("your-google-ai-studio-key-here")
        || lower.contains("sk-ant-your-key-here")
        || lower.contains("placeholder")
        || lower.contains("paste-your")
}

async fn call_gemini(user_message: &str) -> Result<String, String> {
    let api_key = require_gemini_key()?;
    let base_url = std::env::var("GEMINI_BASE_URL")
        .unwrap_or_else(|_| "https://generativelanguage.googleapis.com".to_string());
    let model = std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-2.0-flash".to_string());

    // Google AI Studio: POST /v1beta/models/{model}:generateContent
    let endpoint = format!(
        "{}/v1beta/models/{}:generateContent",
        base_url.trim_end_matches('/'),
        model.trim()
    );

    let body = json!({
        "system_instruction": {
            "parts": [{ "text": SYSTEM_PROMPT }]
        },
        "contents": [{
            "role": "user",
            "parts": [{ "text": user_message }]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json"
        }
    });

    let client = http_client()?;
    let response = client
        .post(&endpoint)
        .header("x-goog-api-key", api_key)
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini API request failed: {e}"))?;

    let response_text = read_success_body(response).await?;
    let message: GeminiGenerateContentResponse =
        serde_json::from_str(&response_text).map_err(|e| {
            format!(
                "Invalid Gemini response envelope: {e}. Body: {}",
                truncate_for_error(&response_text)
            )
        })?;

    message
        .candidates
        .as_ref()
        .and_then(|candidates| candidates.first())
        .and_then(|candidate| candidate.content.as_ref())
        .and_then(|content| content.parts.as_ref())
        .and_then(|parts| parts.iter().find_map(|part| part.text.as_ref()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Gemini API returned no text content.".to_string())
}

async fn call_openai_compatible(user_message: &str) -> Result<String, String> {
    let api_key = require_env_key("OPENAI_API_KEY")?;
    let base_url = std::env::var("OPENAI_BASE_URL")
        .unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
    let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string());
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let body = json!({
        "model": model,
        "temperature": 0.2,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": user_message }
        ]
    });

    let client = http_client()?;
    let response = client
        .post(&endpoint)
        .header(AUTHORIZATION, format!("Bearer {api_key}"))
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API request failed: {e}"))?;

    let response_text = read_success_body(response).await?;
    let completion: ChatCompletionResponse = serde_json::from_str(&response_text).map_err(|e| {
        format!(
            "Invalid OpenAI response envelope: {e}. Body: {}",
            truncate_for_error(&response_text)
        )
    })?;

    completion
        .choices
        .first()
        .and_then(|choice| choice.message.content.as_ref())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "API returned no message content.".to_string())
}

async fn call_anthropic(user_message: &str) -> Result<String, String> {
    let api_key = require_env_key("ANTHROPIC_API_KEY")?;
    let base_url = std::env::var("ANTHROPIC_BASE_URL")
        .unwrap_or_else(|_| "https://api.anthropic.com".to_string());
    let model =
        std::env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| "claude-sonnet-4-20250514".to_string());
    let endpoint = format!("{}/v1/messages", base_url.trim_end_matches('/'));

    let body = json!({
        "model": model,
        "max_tokens": 2048,
        "temperature": 0.2,
        "system": SYSTEM_PROMPT,
        "messages": [
            { "role": "user", "content": user_message }
        ]
    });

    let client = http_client()?;
    let response = client
        .post(&endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic API request failed: {e}"))?;

    let response_text = read_success_body(response).await?;
    let message: AnthropicMessageResponse = serde_json::from_str(&response_text).map_err(|e| {
        format!(
            "Invalid Anthropic response envelope: {e}. Body: {}",
            truncate_for_error(&response_text)
        )
    })?;

    message
        .content
        .iter()
        .find(|block| block.kind == "text")
        .and_then(|block| block.text.as_ref())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Anthropic API returned no text content.".to_string())
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))
}

async fn read_success_body(response: reqwest::Response) -> Result<String, String> {
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read API response: {e}"))?;

    if !status.is_success() {
        // Friendly copy for transient Gemini/provider overload — keep raw body in logs only.
        if status.as_u16() == 503
            || response_text.to_ascii_uppercase().contains("UNAVAILABLE")
        {
            eprintln!(
                "[pixle ai] provider unavailable ({status}): {}",
                truncate_for_error(&response_text)
            );
            return Err(
                "Gemini is temporarily busy. Please try again in a moment.".to_string(),
            );
        }

        return Err(format!(
            "API returned {status}: {}",
            truncate_for_error(&response_text)
        ));
    }

    Ok(response_text)
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

const SCALAR_KEYS: [&str; 22] = [
    "exposure",
    "contrast",
    "highlights",
    "shadows",
    "whites",
    "blacks",
    "fade",
    "temperature",
    "tint",
    "saturation",
    "vibrance",
    "grainAmount",
    "grainSize",
    "grainRoughness",
    "grainColor",
    "clarity",
    "sharpening",
    "luminanceNoiseReduction",
    "chromaNoiseReduction",
    "vignetteAmount",
    "vignetteMidpoint",
    "vignetteFeather",
];

const HSL_COLORS: [&str; 8] = [
    "red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta",
];

const HSL_CHANNELS: [&str; 3] = ["hue", "saturation", "luminance"];

fn parse_hsl_band(obj: &Map<String, Value>, color: &str) -> Result<HslBand, String> {
    let value = obj
        .get(color)
        .ok_or_else(|| format!("Missing required field `hsl.{color}`."))?;
    let band = value
        .as_object()
        .ok_or_else(|| format!("Field `hsl.{color}` must be an object."))?;

    for channel in HSL_CHANNELS {
        if !band.contains_key(channel) {
            return Err(format!("Missing required field `hsl.{color}.{channel}`."));
        }
    }
    for key in band.keys() {
        if !HSL_CHANNELS.contains(&key.as_str()) {
            return Err(format!("Unexpected field `hsl.{color}.{key}`."));
        }
    }

    Ok(HslBand {
        hue: read_number(band, "hue", -100.0, 100.0)?,
        saturation: read_number(band, "saturation", -100.0, 100.0)?,
        luminance: read_number(band, "luminance", -100.0, 100.0)?,
    })
}

fn parse_hsl(value: &Value) -> Result<HslAdjustments, String> {
    let obj = value
        .as_object()
        .ok_or_else(|| "Field `hsl` must be an object.".to_string())?;

    for color in HSL_COLORS {
        if !obj.contains_key(color) {
            return Err(format!("Missing required field `hsl.{color}`."));
        }
    }
    for key in obj.keys() {
        if !HSL_COLORS.contains(&key.as_str()) {
            return Err(format!("Unexpected field `hsl.{key}`."));
        }
    }

    Ok(HslAdjustments {
        red: parse_hsl_band(obj, "red")?,
        orange: parse_hsl_band(obj, "orange")?,
        yellow: parse_hsl_band(obj, "yellow")?,
        green: parse_hsl_band(obj, "green")?,
        aqua: parse_hsl_band(obj, "aqua")?,
        blue: parse_hsl_band(obj, "blue")?,
        purple: parse_hsl_band(obj, "purple")?,
        magenta: parse_hsl_band(obj, "magenta")?,
    })
}

/// Soft UI budget matching the Ask-pixle status line.
const EDIT_SUMMARY_MAX_CHARS: usize = 45;
const EDIT_SUMMARY_MAX_WORDS: usize = 7;

/// Turn a model `edit_summary` into a short glance phrase.
/// About 3–7 words / ≤45 chars, never starts with "Applied", no ellipsis cut.
fn shorten_edit_summary(raw: &str) -> Option<String> {
    let mut text = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }

    if let Some(rest) = text
        .strip_prefix("Applied ")
        .or_else(|| text.strip_prefix("applied "))
        .or_else(|| text.strip_prefix("APPLIED "))
    {
        text = rest.trim().to_string();
    }
    if text.is_empty() {
        return None;
    }

    // Phrase style: drop terminal sentence punctuation / ellipsis.
    while text.ends_with('.') || text.ends_with('…') {
        text.pop();
        text = text.trim_end().to_string();
    }
    text = text.replace('…', " ").replace("...", " ");
    text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }

    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return None;
    }

    let mut kept: Vec<&str> = Vec::new();
    for word in &words {
        if kept.len() >= EDIT_SUMMARY_MAX_WORDS {
            break;
        }
        let candidate = if kept.is_empty() {
            (*word).to_string()
        } else {
            format!("{} {}", kept.join(" "), word)
        };
        if candidate.chars().count() > EDIT_SUMMARY_MAX_CHARS {
            break;
        }
        kept.push(word);
    }

    if kept.is_empty() {
        // Prefer whole first word over mid-word slicing.
        let first = words[0].trim_end_matches([',', ':', ';']).to_string();
        return if first.is_empty() { None } else { Some(first) };
    }
    let joined = kept.join(" ");
    let cleaned = joined.trim_end_matches([',', ':', ';']).trim();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned.to_string())
    }
}

fn parse_edit_response(value: &Value) -> Result<EditFromPromptResult, String> {
    let obj = value
        .as_object()
        .ok_or_else(|| "EditParameters JSON must be an object.".to_string())?;

    // Reject unexpected payload shapes (e.g. image blobs) before applying.
    // `edit_summary` is the only optional non-parameter field allowed.
    const OPTIONAL: [&str; 1] = ["edit_summary"];

    for key in SCALAR_KEYS {
        if !obj.contains_key(key) {
            return Err(format!("Missing required field `{key}`."));
        }
    }
    if !obj.contains_key("hsl") {
        return Err("Missing required field `hsl`.".to_string());
    }

    for key in obj.keys() {
        let allowed = SCALAR_KEYS.contains(&key.as_str())
            || key == "hsl"
            || OPTIONAL.contains(&key.as_str());
        if !allowed {
            return Err(format!("Unexpected field `{key}` in EditParameters."));
        }
    }

    let edit_summary = match obj.get("edit_summary") {
        None => None,
        Some(Value::Null) => None,
        Some(Value::String(s)) => shorten_edit_summary(s),
        Some(_) => {
            return Err("Field `edit_summary` must be a string when present.".to_string());
        }
    };

    let hsl = parse_hsl(obj.get("hsl").unwrap())?;

    Ok(EditFromPromptResult {
        parameters: EditParameters {
            exposure: read_number(obj, "exposure", -2.0, 2.0)?,
            contrast: read_number(obj, "contrast", -100.0, 100.0)?,
            highlights: read_number(obj, "highlights", -100.0, 100.0)?,
            shadows: read_number(obj, "shadows", -100.0, 100.0)?,
            whites: read_number(obj, "whites", -100.0, 100.0)?,
            blacks: read_number(obj, "blacks", -100.0, 100.0)?,
            fade: read_number(obj, "fade", 0.0, 100.0)?,
            temperature: read_number(obj, "temperature", -100.0, 100.0)?,
            tint: read_number(obj, "tint", -100.0, 100.0)?,
            saturation: read_number(obj, "saturation", -100.0, 100.0)?,
            vibrance: read_number(obj, "vibrance", -100.0, 100.0)?,
            grain_amount: read_number(obj, "grainAmount", 0.0, 100.0)?,
            grain_size: read_number(obj, "grainSize", 0.0, 100.0)?,
            grain_roughness: read_number(obj, "grainRoughness", 0.0, 100.0)?,
            grain_color: read_number(obj, "grainColor", 0.0, 100.0)?,
            clarity: read_number(obj, "clarity", -100.0, 100.0)?,
            sharpening: read_number(obj, "sharpening", 0.0, 100.0)?,
            luminance_noise_reduction: read_number(obj, "luminanceNoiseReduction", 0.0, 100.0)?,
            chroma_noise_reduction: read_number(obj, "chromaNoiseReduction", 0.0, 100.0)?,
            vignette_amount: read_number(obj, "vignetteAmount", -100.0, 100.0)?,
            vignette_midpoint: read_number(obj, "vignetteMidpoint", 0.0, 100.0)?,
            vignette_feather: read_number(obj, "vignetteFeather", 0.0, 100.0)?,
            hsl,
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

    fn sample_full_params() -> Value {
        let band = json!({ "hue": 0, "saturation": 0, "luminance": 0 });
        json!({
            "exposure": 0.0,
            "contrast": 0.0,
            "highlights": 0.0,
            "shadows": 0.0,
            "whites": 0.0,
            "blacks": 0.0,
            "fade": 0.0,
            "temperature": 0.0,
            "tint": 0.0,
            "saturation": 0.0,
            "vibrance": 0.0,
            "grainAmount": 0.0,
            "grainSize": 40.0,
            "grainRoughness": 35.0,
            "grainColor": 0.0,
            "clarity": 0.0,
            "sharpening": 0.0,
            "luminanceNoiseReduction": 0.0,
            "chromaNoiseReduction": 0.0,
            "vignetteAmount": 0.0,
            "vignetteMidpoint": 50.0,
            "vignetteFeather": 50.0,
            "hsl": {
                "red": band,
                "orange": band,
                "yellow": band,
                "green": band,
                "aqua": band,
                "blue": band,
                "purple": band,
                "magenta": band
            }
        })
    }

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
        let mut value = sample_full_params();
        let obj = value.as_object_mut().unwrap();
        obj.insert("exposure".into(), json!(0.4));
        obj.insert("contrast".into(), json!(25));
        obj.insert("highlights".into(), json!(-30));
        obj.insert("shadows".into(), json!(10));
        obj.insert("vibrance".into(), json!(15));
        obj.insert("grainAmount".into(), json!(20));
        obj.insert("fade".into(), json!(8));
        let hsl = obj.get_mut("hsl").unwrap().as_object_mut().unwrap();
        hsl.insert(
            "blue".into(),
            json!({ "hue": 0, "saturation": -12, "luminance": 9 }),
        );

        let parsed = parse_edit_response(&value).unwrap();
        assert_eq!(parsed.parameters.exposure, 0.4);
        assert_eq!(parsed.parameters.highlights, -30.0);
        assert_eq!(parsed.parameters.vibrance, 15.0);
        assert_eq!(parsed.parameters.grain_amount, 20.0);
        assert_eq!(parsed.parameters.fade, 8.0);
        assert_eq!(parsed.parameters.hsl.blue.saturation, -12.0);
        assert_eq!(parsed.parameters.hsl.blue.luminance, 9.0);
        assert!(parsed.edit_summary.is_none());
    }

    #[test]
    fn accepts_optional_edit_summary() {
        let mut value = sample_full_params();
        let obj = value.as_object_mut().unwrap();
        obj.insert("exposure".into(), json!(0.2));
        obj.insert(
            "edit_summary".into(),
            json!("  Warm Kodak Gold  "),
        );
        let parsed = parse_edit_response(&value).unwrap();
        assert_eq!(parsed.parameters.exposure, 0.2);
        assert_eq!(parsed.edit_summary.as_deref(), Some("Warm Kodak Gold"));
    }

    #[test]
    fn shortens_long_edit_summary_on_word_boundaries() {
        let mut value = sample_full_params();
        let obj = value.as_object_mut().unwrap();
        obj.insert(
            "edit_summary".into(),
            json!(
                "Applied Kodak Gold aesthetic with warm golden tones, rich yellows and soft contrast throughout"
            ),
        );
        let parsed = parse_edit_response(&value).unwrap();
        let summary = parsed.edit_summary.expect("summary");
        assert!(!summary.to_lowercase().starts_with("applied"));
        assert!(!summary.contains('…'));
        assert!(summary.chars().count() <= 45);
        assert!(summary.split_whitespace().count() <= 7);
        assert_eq!(summary, "Kodak Gold aesthetic with warm golden tones");
    }

    #[test]
    fn rejects_non_string_edit_summary() {
        let mut value = sample_full_params();
        value
            .as_object_mut()
            .unwrap()
            .insert("edit_summary".into(), json!(123));
        let err = parse_edit_response(&value).unwrap_err();
        assert!(err.contains("edit_summary"));
    }

    #[test]
    fn rejects_unexpected_fields() {
        let mut value = sample_full_params();
        value
            .as_object_mut()
            .unwrap()
            .insert("imageBase64".into(), json!("abc"));
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
        let mut value = sample_full_params();
        value
            .as_object_mut()
            .unwrap()
            .insert("exposure".into(), json!("bright"));
        let err = parse_edit_response(&value).unwrap_err();
        assert!(err.contains("must be a number"));
    }

    #[test]
    fn clamps_out_of_range_values() {
        let mut value = sample_full_params();
        let obj = value.as_object_mut().unwrap();
        obj.insert("exposure".into(), json!(9.0));
        obj.insert("contrast".into(), json!(-500));
        obj.insert("fade".into(), json!(200));
        let parsed = parse_edit_response(&value).unwrap();
        assert_eq!(parsed.parameters.exposure, 2.0);
        assert_eq!(parsed.parameters.contrast, -100.0);
        assert_eq!(parsed.parameters.fade, 100.0);
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

        let current: EditParameters = serde_json::from_value(sample_full_params()).unwrap();
        let next = edit_from_prompt("make it brighter".into(), current, sample_analysis())
            .await
            .expect("live AI edit should succeed");
        assert!(next.parameters.exposure > 0.0);
    }
}
