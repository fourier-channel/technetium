// Read an image file's pixel dimensions by loading it into an off-DOM <img>.
// Used to populate m.image `info.w/h` so other clients can size the thumbnail
// before downloading. Best-effort: callers treat a rejection as "no dimensions".
export function readImageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const dims = { w: img.naturalWidth, h: img.naturalHeight }
      URL.revokeObjectURL(url)
      resolve(dims)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('could not read image dimensions'))
    }
    img.src = url
  })
}
