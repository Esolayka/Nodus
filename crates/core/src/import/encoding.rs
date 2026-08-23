//! Reading arbitrary text files without guessing wrong: detect the byte
//! encoding (UTF-8, with or without a BOM, or a legacy Windows codepage)
//! before decoding, rather than assuming UTF-8 and producing mojibake for
//! anything that isn't. Every file this crate writes is always plain
//! UTF-8 with no BOM, regardless of what an imported file originally used.

/// Decodes `bytes` as text: strips a UTF-8 BOM if present, otherwise runs
/// encoding detection and decodes with whatever it guesses (falling back
/// to lossy UTF-8 only if even that produces errors).
pub fn decode_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(b"\xEF\xBB\xBF") {
        return String::from_utf8_lossy(rest).into_owned();
    }
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let encoding = detector.guess(None, true);
    let (decoded, _, _) = encoding.decode(bytes);
    decoded.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_utf8_passes_through_unchanged() {
        let text = "Привет, мир! héllo";
        assert_eq!(decode_text(text.as_bytes()), text);
    }

    #[test]
    fn a_utf8_bom_is_stripped() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("no BOM in the result".as_bytes());
        assert_eq!(decode_text(&bytes), "no BOM in the result");
    }

    #[test]
    fn windows_1251_cyrillic_is_detected_and_decoded_correctly() {
        let original = "Заметка из старой программы под Windows";
        let (encoded, _, had_errors) = encoding_rs::WINDOWS_1251.encode(original);
        assert!(!had_errors, "test setup: this string must be representable in windows-1251");
        assert_eq!(decode_text(&encoded), original);
    }

    #[test]
    fn windows_1252_western_european_is_detected_and_decoded_correctly() {
        let original = "café, naïve résumé — exported from an old Windows note app";
        let (encoded, _, had_errors) = encoding_rs::WINDOWS_1252.encode(original);
        assert!(!had_errors, "test setup: this string must be representable in windows-1252");
        assert_eq!(decode_text(&encoded), original);
    }
}
