use askama::Template;
#[derive(Template)]
#[template(path = "participant.html")]
pub struct ParticipantRow<'a> {
    pub participant_id: &'a str,
    pub nickname: &'a str,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_and_identifiers_are_escaped() {
        let html = ParticipantRow {
            participant_id: "\" onclick=\"evil",
            nickname: "<script>alert(1)</script>",
        }
        .render()
        .unwrap();
        assert!(!html.contains("<script>"));
        assert!(!html.contains("data-id=\"\" onclick="));
        assert!(
            html.contains("&lt;script&gt;") || html.contains("&#60;script&#62;"),
            "{html}"
        );
    }
}
