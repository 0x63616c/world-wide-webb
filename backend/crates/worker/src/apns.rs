//! APNs signing and calendar scheduling, independent of the Worker transport.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{LocalResult, TimeZone, Utc};
use p256::{
    ecdsa::{Signature, SigningKey, signature::Signer},
    pkcs8::DecodePrivateKey,
};
use sha2::{Digest, Sha256};

pub fn provider_token(
    private_key: &[u8],
    key_id: &str,
    team_id: &str,
    seconds: i64,
) -> Option<String> {
    if seconds < 0
        || private_key.len() > 4096
        || key_id.len() != 10
        || team_id.len() != 10
        || !key_id
            .bytes()
            .chain(team_id.bytes())
            .all(|b| b.is_ascii_alphanumeric())
    {
        return None;
    }
    let key = SigningKey::from_pkcs8_der(private_key).ok()?;
    let header = URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&serde_json::json!({"alg":"ES256","kid":key_id})).ok()?);
    let claims = URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&serde_json::json!({"iss":team_id,"iat":seconds})).ok()?);
    let message = format!("{header}.{claims}");
    let signature: Signature = key.sign(message.as_bytes());
    Some(format!(
        "{message}.{}",
        URL_SAFE_NO_PAD.encode(signature.to_bytes())
    ))
}
/// The first existing local 09:00 strictly after publication. An ambiguous wall time
/// selects the first future occurrence; a skipped wall time advances to the next day.
pub fn next_morning(finalized_ms: i64, timezone: &str) -> Option<i64> {
    let tz: chrono_tz::Tz = timezone.parse().ok()?;
    let instant = chrono::DateTime::<Utc>::from_timestamp_millis(finalized_ms)?;
    let mut date = instant.with_timezone(&tz).date_naive();
    for _ in 0..8 {
        let wall = date.and_hms_opt(9, 0, 0)?;
        let mut candidates = match tz.from_local_datetime(&wall) {
            LocalResult::Single(a) => vec![a.timestamp_millis()],
            LocalResult::Ambiguous(a, b) => vec![a.timestamp_millis(), b.timestamp_millis()],
            LocalResult::None => vec![],
        };
        candidates.sort_unstable();
        if let Some(value) = candidates.into_iter().find(|v| *v > finalized_ms) {
            return Some(value);
        }
        date = date.succ_opt()?;
    }
    None
}
pub fn identifiers(participant: &str, period: &str) -> (String, String) {
    let digest = Sha256::digest(format!("Folding-award\n{participant}\n{period}"));
    let collapse = digest
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let mut id: [u8; 16] = digest[..16].try_into().expect("fixed digest");
    id[6] = (id[6] & 15) | 0x50;
    id[8] = (id[8] & 63) | 0x80;
    let h = id.iter().map(|b| format!("{b:02x}")).collect::<String>();
    (
        format!(
            "{}-{}-{}-{}-{}",
            &h[..8],
            &h[8..12],
            &h[12..16],
            &h[16..20],
            &h[20..]
        ),
        collapse,
    )
}
pub fn payload(
    locale: &str,
    kind: &str,
    period: &str,
    rank: i64,
    medal: Option<&str>,
) -> serde_json::Value {
    let monthly = kind == "month";
    let (weekly, month, body) = match locale {
        "de" => (
            "Wochenergebnis",
            "Monatsergebnis",
            format!("Du hast Platz {rank} erreicht."),
        ),
        "fr" => (
            "Résultat de la semaine",
            "Résultat du mois",
            format!("Vous avez terminé à la place {rank}."),
        ),
        "es" | "es-419" => (
            "Resultado semanal",
            "Resultado mensual",
            format!("Has quedado en el puesto {rank}."),
        ),
        "ja" => (
            "今週の結果",
            "今月の結果",
            format!("{rank}位に入りました。"),
        ),
        "ko" => ("주간 결과", "월간 결과", format!("{rank}위를 달성했어요.")),
        "pt-BR" => (
            "Resultado semanal",
            "Resultado mensal",
            format!("Você ficou em {rank}º lugar."),
        ),
        "zh-Hans" => ("每周成绩", "每月成绩", format!("你获得了第{rank}名。")),
        "zh-Hant" => ("每週成績", "每月成績", format!("你獲得了第{rank}名。")),
        _ => (
            "Weekly result",
            "Monthly result",
            format!("You placed #{rank}."),
        ),
    };
    let icon = match medal {
        Some("gold") => "🥇 ",
        Some("silver") => "🥈 ",
        Some("bronze") => "🥉 ",
        _ => "",
    };
    serde_json::json!({"aps":{"alert":{"title":format!("{icon}{}",if monthly{month}else{weekly}),"body":body},"sound":"default"},"folding":{"kind":if monthly{"monthly_result"}else{"weekly_result"},"period_id":period}})
}

pub fn badge_payload(locale: &str, participant: &str, badges: &[String]) -> serde_json::Value {
    let group = badges.len() > 1;
    let (one, many, body) = match locale {
        "de" => (
            "Abzeichen verdient",
            "Abzeichen verdient",
            "In Folding ansehen.",
        ),
        "fr" => ("Badge obtenu", "Badges obtenus", "Voir dans Folding."),
        "es" | "es-419" => (
            "Insignia conseguida",
            "Insignias conseguidas",
            "Ver en Folding.",
        ),
        "ja" => ("バッジを獲得", "バッジを獲得", "Foldingで確認できます。"),
        "ko" => ("배지 획득", "배지 획득", "Folding에서 확인하세요."),
        "pt-BR" => (
            "Emblema conquistado",
            "Emblemas conquistados",
            "Ver no Folding.",
        ),
        "zh-Hans" => ("获得徽章", "获得徽章", "在 Folding 中查看。"),
        "zh-Hant" => ("獲得徽章", "獲得徽章", "在 Folding 中查看。"),
        _ => ("Badge earned", "Badges earned", "View in Folding."),
    };
    serde_json::json!({"aps":{"alert":{"title":if group{many}else{one},"body":body},"sound":"default"},"folding":{"kind":"badges_earned","participant_id":participant,"badge_ids":badges}})
}

#[cfg(test)]
mod badge_tests {
    use super::*;
    #[test]
    fn badges_have_one_private_grouped_payload_in_every_supported_locale() {
        for locale in [
            "en", "de", "fr", "es", "es-419", "ja", "ko", "pt-BR", "zh-Hans", "zh-Hant",
        ] {
            let ids = vec!["folds_1".to_string(), "days_7".to_string()];
            let payload = badge_payload(locale, "owner", &ids);
            assert_eq!(payload["folding"]["badge_ids"], serde_json::json!(ids));
            assert_eq!(payload["folding"]["participant_id"], "owner");
            let alert = &payload["aps"]["alert"];
            assert!(!alert["title"].as_str().unwrap().is_empty());
            assert!(!alert.to_string().contains("folds_1"));
            assert_eq!(
                identifiers("owner", "badge:batch"),
                identifiers("owner", "badge:batch")
            );
            assert_ne!(
                identifiers("owner", "badge:batch"),
                identifiers("other", "badge:batch")
            );
        }
    }
}
