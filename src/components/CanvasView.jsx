import { useEffect, useRef } from 'react'

// Renders an ImageData into a <canvas>, resizing the canvas to match.
export function CanvasView({ imageData, className = '', style }) {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !imageData) return
    if (c.width !== imageData.width) c.width = imageData.width
    if (c.height !== imageData.height) c.height = imageData.height
    c.getContext('2d').putImageData(imageData, 0, 0)
  }, [imageData])
  return <canvas ref={ref} className={className} style={style} />
}
