//! Versioned whole-word checks for names that publish immediately after validation.
use serde::Deserialize;
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;
#[derive(Deserialize)]
struct Policy {
    version: String,
    reject_whole_words: Vec<String>,
    reserved_whole_names: Vec<String>,
}
#[derive(Debug)]
pub struct InvalidName;
pub struct PendingName {
    pub display: String,
    pub policy_version: String,
}
fn detection(value: &str) -> String {
    value.nfkc().case_fold().collect()
}
pub fn validate(value: &str) -> Result<PendingName, InvalidName> {
    if value.len() > 1024 {
        return Err(InvalidName);
    }
    let display: String = value.trim().nfc().collect();
    if !(3..=20).contains(&display.graphemes(true).count())||display.chars().any(|c|c.is_control()||matches!(c,'\u{200b}'..='\u{200f}'|'\u{202a}'..='\u{202e}'|'\u{2060}'..='\u{206f}'|'\u{feff}'))||display.contains("  "){return Err(InvalidName);}
    let normalized = detection(&display);
    if normalized.contains("://")
        || normalized.contains("www.")
        || normalized.split_whitespace().any(|w| {
            w.contains('.')
                && [".com", ".app", ".net", ".org", ".io"]
                    .iter()
                    .any(|suffix| w.ends_with(suffix))
        })
    {
        return Err(InvalidName);
    }
    let policy: Policy =
        serde_json::from_str(include_str!("../policies/names-v1.json")).map_err(|_| InvalidName)?;
    let words: Vec<_> = normalized.unicode_words().collect();
    let compact: String = normalized
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '@' | '$'))
        .map(|c| match c {
            '0' => 'o',
            '1' => 'i',
            '3' => 'e',
            '4' | '@' => 'a',
            '5' | '$' => 's',
            '7' => 't',
            _ => c,
        })
        .collect();
    if policy
        .reserved_whole_names
        .iter()
        .any(|w| detection(w) == normalized)
        || policy.reject_whole_words.iter().any(|w| {
            let banned = detection(w);
            words.iter().any(|part| *part == banned) || normalized == banned || compact == banned
        })
    {
        return Err(InvalidName);
    }
    Ok(PendingName {
        display,
        policy_version: policy.version,
    })
}
