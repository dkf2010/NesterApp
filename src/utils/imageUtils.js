/**
 * Compresses and resizes an image file/blob to a standard JPEG.
 * Solves iPhone / mobile camera upload issues (HEIC format, 10MB+ file size exceeding PHP limits).
 *
 * @param {Blob|File} file
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @param {number} quality (0.0 to 1.0)
 * @returns {Promise<Blob>}
 */
export const compressImageFile = async (file, maxWidth = 1280, maxHeight = 1280, quality = 0.8) => {
    return new Promise((resolve) => {
        // If not a standard image or SVG, return as is
        if (!file || (file.type && !file.type.startsWith('image/')) || file.type === 'image/svg+xml') {
            resolve(file);
            return;
        }

        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            let { width, height } = img;

            // Compute scaling ratio
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                resolve(file);
                return;
            }

            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        resolve(file);
                    }
                },
                'image/jpeg',
                quality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(file); // fallback to original file
        };

        img.src = objectUrl;
    });
};
