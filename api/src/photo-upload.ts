import { FileTypeValidator, ParseFilePipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

// One validation story for every image upload (entry photos, avatars): the
// web app compresses to JPEG under 500 KB, so anything else is a bypass.
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Multipart `file` field, refused with 413 before the handler if over the cap. */
export const photoFileInterceptor = () =>
  FileInterceptor('file', { limits: { fileSize: PHOTO_MAX_BYTES } });

/** 400 when the file is missing or its bytes are not a JPEG. */
export const jpegFilePipe = () =>
  new ParseFilePipe({
    validators: [new FileTypeValidator({ fileType: 'image/jpeg' })],
  });
