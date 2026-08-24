//! Content-addressed chunking for large blobs, so the sync server transfers
//! only the pieces of a file that actually changed instead of the whole
//! thing on every save. This is the delta mechanism the encryption model
//! can actually support: a byte-level diff against ciphertext is useless
//! (a fresh nonce makes even a one-character edit change every byte of
//! output), so the plaintext is split into fixed-size chunks *before*
//! encryption, and each chunk is encrypted — and addressed — independently.
//! Same approach content-addressed backup tools like restic/borg use over
//! storage that can't be trusted with plaintext.

use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::content;
use crate::error::Result;
use crate::keys::{self, Dek};

type HmacSha256 = Hmac<Sha256>;

/// 4 MiB — small enough that a single changed chunk in a large attachment is
/// cheap to re-upload, large enough that manifest overhead stays negligible
/// next to typical note and image sizes. A file smaller than this is just
/// one chunk, which is the correct degenerate case, not a special path.
pub const CHUNK_SIZE: usize = 4 * 1024 * 1024;

/// One piece of a chunked file: its content-derived id and its encrypted
/// bytes, ready to store or transfer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedChunk {
    pub id: String,
    pub ciphertext: Vec<u8>,
}

fn chunk_id(hmac_key: &[u8; content::KEY_LEN], piece: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(hmac_key).expect("HMAC accepts any key length");
    mac.update(piece);
    hex::encode(mac.finalize().into_bytes())
}

/// Splits `plaintext` into fixed-size chunks and encrypts each one
/// independently (its own random nonce). Each chunk's id is a *keyed* hash
/// (HMAC under a DEK-derived sub-key) rather than a bare content hash —
/// a bare hash would let the server recognize identical chunks across
/// different users' vaults, leaking which files are duplicates of one
/// another. The returned id list is the file's manifest: small, and cheap
/// to re-send on every sync even when the chunks it points at aren't.
pub fn split_and_encrypt(dek: &Dek, plaintext: &[u8]) -> Vec<EncryptedChunk> {
    let hmac_key = keys::chunk_hmac_key(dek);
    let content_key = keys::content_key(dek);
    let encrypt_piece = |piece: &[u8]| EncryptedChunk {
        id: chunk_id(&hmac_key, piece),
        ciphertext: content::encrypt(&content_key, piece),
    };
    if plaintext.is_empty() {
        // An empty file is still one chunk (of zero bytes), so "no content"
        // is representable as an ordinary one-entry manifest rather than a
        // special case every caller has to know about.
        return vec![encrypt_piece(&[])];
    }
    plaintext.chunks(CHUNK_SIZE).map(encrypt_piece).collect()
}

pub fn decrypt_chunk(dek: &Dek, ciphertext: &[u8]) -> Result<Vec<u8>> {
    let content_key = keys::content_key(dek);
    content::decrypt(&content_key, ciphertext)
}

/// Reassembles plaintext from decrypted chunk bytes, in manifest order. The
/// caller fetches and decrypts only the chunks it doesn't already have
/// locally before calling this.
pub fn join_chunks(chunks: &[Vec<u8>]) -> Vec<u8> {
    chunks.concat()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_smaller_than_chunk_size_yields_one_chunk() {
        let dek = Dek::generate();
        let chunks = split_and_encrypt(&dek, b"a small note");
        assert_eq!(chunks.len(), 1);
    }

    #[test]
    fn empty_content_still_yields_one_chunk() {
        let dek = Dek::generate();
        let chunks = split_and_encrypt(&dek, b"");
        assert_eq!(chunks.len(), 1);
    }

    #[test]
    fn content_splits_into_the_expected_number_of_chunks() {
        let dek = Dek::generate();
        let plaintext = vec![7u8; CHUNK_SIZE * 2 + 100];
        let chunks = split_and_encrypt(&dek, &plaintext);
        assert_eq!(chunks.len(), 3);
    }

    #[test]
    fn roundtrips_through_split_encrypt_decrypt_join() {
        let dek = Dek::generate();
        let plaintext = vec![42u8; CHUNK_SIZE + 12345];
        let encrypted = split_and_encrypt(&dek, &plaintext);
        let decrypted: Vec<Vec<u8>> = encrypted
            .iter()
            .map(|c| decrypt_chunk(&dek, &c.ciphertext).unwrap())
            .collect();
        assert_eq!(join_chunks(&decrypted), plaintext);
    }

    #[test]
    fn identical_chunks_get_the_same_id_so_the_server_can_dedupe() {
        let dek = Dek::generate();
        let plaintext = [vec![1u8; CHUNK_SIZE], vec![1u8; CHUNK_SIZE]].concat();
        let chunks = split_and_encrypt(&dek, &plaintext);
        assert_eq!(
            chunks[0].id, chunks[1].id,
            "two identical chunks must share an id to dedupe"
        );
        assert_ne!(
            chunks[0].ciphertext, chunks[1].ciphertext,
            "but their ciphertexts must still differ (independent random nonces)"
        );
    }

    #[test]
    fn a_one_byte_edit_only_changes_the_id_of_the_chunk_it_falls_in() {
        // The entire point of chunking: editing a single character deep in
        // a large file should re-upload one 4 MiB piece, not the whole file.
        let dek = Dek::generate();
        let mut plaintext = Vec::new();
        plaintext.extend_from_slice(&vec![1u8; CHUNK_SIZE]);
        plaintext.extend_from_slice(&vec![2u8; CHUNK_SIZE]);
        plaintext.extend_from_slice(&vec![3u8; CHUNK_SIZE]);
        let before = split_and_encrypt(&dek, &plaintext);

        plaintext[CHUNK_SIZE + 10] ^= 0xff; // flip a byte inside the middle chunk
        let after = split_and_encrypt(&dek, &plaintext);

        assert_eq!(
            before[0].id, after[0].id,
            "untouched first chunk keeps its id"
        );
        assert_ne!(
            before[1].id, after[1].id,
            "edited middle chunk gets a new id"
        );
        assert_eq!(
            before[2].id, after[2].id,
            "untouched last chunk keeps its id"
        );
    }

    #[test]
    fn different_deks_yield_different_ids_for_the_same_content() {
        // The id is a *keyed* hash, not a bare content hash — otherwise the
        // server could tell that two different users' vaults contain an
        // identical file, which is exactly the structural leak encryption
        // is supposed to prevent.
        let plaintext = vec![9u8; 1000];
        let a = split_and_encrypt(&Dek::generate(), &plaintext);
        let b = split_and_encrypt(&Dek::generate(), &plaintext);
        assert_ne!(a[0].id, b[0].id);
    }

    #[test]
    fn decrypt_fails_with_the_wrong_dek() {
        let dek = Dek::generate();
        let chunks = split_and_encrypt(&dek, b"some content");
        assert!(decrypt_chunk(&Dek::generate(), &chunks[0].ciphertext).is_err());
    }
}
