use image::{
    DynamicImage, GenericImageView, ImageDecoder, ImageFormat, ImageReader, Limits,
    codecs::{jpeg::JpegEncoder, png::PngDecoder},
};
use std::io::Cursor;

pub const MAX_INPUT_BYTES: usize = 5 * 1024 * 1024;
#[derive(Debug, PartialEq, Eq)]
pub enum AvatarError {
    TooLarge,
    Unsupported,
    InvalidImage,
    Dimensions,
    Animated,
}
fn limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(64 * 1024 * 1024);
    limits
}
fn dimensions(width: u32, height: u32) -> Result<(), AvatarError> {
    if !(64..=4096).contains(&width)
        || !(64..=4096).contains(&height)
        || u64::from(width) * u64::from(height) > 16_000_000
    {
        Err(AvatarError::Dimensions)
    } else {
        Ok(())
    }
}
/// Bounded input is independently decoded and re-encoded; no original metadata or bytes are served.
/// Runtime CPU/memory acceptance still requires a Worker stress test before enabling uploads.
pub fn derivative(input: &[u8], content_type: &str) -> Result<Vec<u8>, AvatarError> {
    if input.len() > MAX_INPUT_BYTES {
        return Err(AvatarError::TooLarge);
    }
    let format = image::guess_format(input).map_err(|_| AvatarError::Unsupported)?;
    if !matches!(
        (format, content_type),
        (ImageFormat::Png, "image/png") | (ImageFormat::Jpeg, "image/jpeg")
    ) {
        return Err(AvatarError::Unsupported);
    }
    let image = if format == ImageFormat::Png {
        let decoder = PngDecoder::with_limits(Cursor::new(input), limits())
            .map_err(|_| AvatarError::InvalidImage)?;
        if decoder.is_apng().map_err(|_| AvatarError::InvalidImage)? {
            return Err(AvatarError::Animated);
        }
        let (width, height) = decoder.dimensions();
        dimensions(width, height)?;
        DynamicImage::from_decoder(decoder).map_err(|_| AvatarError::InvalidImage)?
    } else {
        let mut reader = ImageReader::with_format(Cursor::new(input), format);
        reader.limits(limits());
        let decoder = reader
            .into_decoder()
            .map_err(|_| AvatarError::InvalidImage)?;
        let (width, height) = decoder.dimensions();
        dimensions(width, height)?;
        DynamicImage::from_decoder(decoder).map_err(|_| AvatarError::InvalidImage)?
    };
    let (width, height) = image.dimensions();
    dimensions(width, height)?;
    let thumbnail = image
        .resize_to_fill(256, 256, image::imageops::FilterType::Lanczos3)
        .to_rgb8();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 85)
        .encode_image(&thumbnail)
        .map_err(|_| AvatarError::InvalidImage)?;
    Ok(bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn converts_and_rejects_outside_bounds() {
        let image = DynamicImage::new_rgb8(96, 64);
        let mut png = Cursor::new(Vec::new());
        image.write_to(&mut png, ImageFormat::Png).unwrap();
        let jpeg = derivative(png.get_ref(), "image/png").unwrap();
        assert_eq!(
            image::load_from_memory(&jpeg).unwrap().dimensions(),
            (256, 256)
        );
        assert_eq!(image::guess_format(&jpeg).unwrap(), ImageFormat::Jpeg);
        assert_eq!(
            derivative(png.get_ref(), "image/jpeg"),
            Err(AvatarError::Unsupported)
        );
        assert_eq!(
            derivative(&vec![0; MAX_INPUT_BYTES + 1], "image/png"),
            Err(AvatarError::TooLarge)
        );
        assert_eq!(dimensions(4096, 4096), Err(AvatarError::Dimensions));
        assert_eq!(dimensions(63, 64), Err(AvatarError::Dimensions));
        assert!(derivative(b"not an image", "image/png").is_err());
    }
}
