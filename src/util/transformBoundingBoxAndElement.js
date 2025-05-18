/**
 * 处理坐标变换的函数
 */
import { Box2 } from 'vecks'

/**
 * Transform the bounding box and the SVG element by the given
 * transforms. The <g> element are created in reverse transform
 * order and the bounding box in the given order.
 */
export default (bbox, element, transforms, pxpremm) => {
  const matrices = transforms.map((transform) => {
    // 计算出 transform matrix 值
    // 平移由tx和ty决定。
    // 缩放由sx和sy决定。
    // 旋转由angle决定，这里将角度从度转换为弧度。
    // 根据extrusionZ的值，可能会对变换矩阵进行镜像处理。
    const tx = transform.x
    const ty = transform.y
    const sx = transform.scaleX || 1
    const sy = transform.scaleY || 1
    const angle = ((transform.rotation || 0) / 180) * Math.PI
    const { cos, sin } = Math
    let a, b, c, d, e, f
    // 在 dxf 中，extrusionZ值为-1表示绕Y轴的变换。
    if (transform.extrusionZ === -1) {
      a = -sx * cos(angle)
      b = sx * sin(angle)
      c = sy * sin(angle)
      d = sy * cos(angle)
      e = -tx
      f = ty
    } else {
      a = sx * cos(angle)
      b = sx * sin(angle)
      c = -sy * sin(angle)
      d = sy * cos(angle)
      e = tx
      f = ty
    }
    return [a, b, c, d, e, f]
  })

  // Only transform the bounding box is it is valid (i.e. not Infinity)
  let transformedBBox = new Box2()
  if (bbox.valid) {
    let bboxPoints = [
      { x: bbox.min.x, y: bbox.min.y },
      { x: bbox.max.x, y: bbox.min.y },
      { x: bbox.max.x, y: bbox.max.y },
      { x: bbox.min.x, y: bbox.max.y },
    ]
    matrices.forEach(([a, b, c, d, e, f]) => {
      bboxPoints = bboxPoints.map((point) => ({
        x: point.x * a + point.y * c + e,
        y: point.x * b + point.y * d + f,
      }))
    })
    transformedBBox = bboxPoints.reduce((acc, point) => {
      const p = {
        x: point.x / pxpremm,
        y: point.y / pxpremm,
      }
      return acc.expandByPoint(p)
    }, new Box2())
  }

  matrices.reverse()

  let transformedElement = ''

  matrices.forEach(([a, b, c, d, e, f]) => {
    transformedElement += `<g transform="matrix(${a},${b},${c},${d},${e / pxpremm},${f / pxpremm})">`
  })

  transformedElement += element

  matrices.forEach(() => {
    transformedElement += '</g>'
  })

  // TODO: 优化 对于脏数据进行清洗
  if (transformedBBox.min.x < 0) {
    transformedBBox.valid = false
  }

  return { bbox: transformedBBox, element: transformedElement }
}
