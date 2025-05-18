/**
 * json 转 svg
 */
import { Box2 } from 'vecks'
import toNumber from 'lodash/toNumber'
import entityToPolyline from './entityToPolyline'
import denormalise from './denormalise'
import getRGBForEntity from './getRGBForEntity'
import logger from './util/logger'
import rotate from './util/rotate'
import rgbToColorAttribute from './util/rgbToColorAttribute'
import toPiecewiseBezier, { multiplicity } from './util/toPiecewiseBezier'
import transformBoundingBoxAndElement from './util/transformBoundingBoxAndElement'
import { isObject } from './util/tools'

// svg 绘制默认配置
const defaultConfig = {
  pxpremm: 1,
}

const addFlipXIfApplicable = (entity, { bbox, element }) => {
  if (entity.extrusionZ === -1) {
    return {
      bbox: new Box2()
        .expandByPoint({ x: -bbox.min.x, y: bbox.min.y })
        .expandByPoint({ x: -bbox.max.x, y: bbox.max.y }),
      element: `<g transform="matrix(-1 0 0 1 0 0)">
        ${element}
      </g>`,
    }
  } else {
    return { bbox, element }
  }
}

/**
 * Create a <path /> element. Interpolates curved entities.
 */
const polyline = (entity, config) => {
  const { pxpremm } = config || defaultConfig
  const vertices = entityToPolyline(entity)
  const bbox = vertices.reduce(
    (acc, [x, y]) => acc.expandByPoint({ x, y }),
    new Box2(),
  )
  const d = vertices.reduce((acc, point, i) => {
    acc += i === 0 ? 'M' : 'L'
    acc += point[0] / pxpremm + ',' + point[1] / pxpremm
    return acc
  }, '')
  // Empirically it appears that flipping horzontally does not apply to polyline
  return transformBoundingBoxAndElement(
    bbox,
    `<path d="${d}" />`,
    entity.transforms,
    pxpremm,
  )
}

/**
 * Create a <circle /> element for the CIRCLE entity.
 */
const circle = (entity, config) => {
  const { pxpremm } = config || defaultConfig
  const bbox0 = new Box2()
    .expandByPoint({
      x: entity.x + entity.r,
      y: entity.y + entity.r,
    })
    .expandByPoint({
      x: entity.x - entity.r,
      y: entity.y - entity.r,
    })
  const converted = {
    //  String 类型 防止精度丢失
    cx: `${entity.x / pxpremm}`,
    cy: `${entity.y / pxpremm}`,
    r: `${entity.r / pxpremm}`,
  }
  const element0 = `<circle cx="${converted.cx}" cy="${converted.cy}" r="${converted.r}" />`
  const { bbox, element } = addFlipXIfApplicable(entity, {
    bbox: bbox0,
    element: element0,
  })
  return transformBoundingBoxAndElement(
    bbox,
    element,
    entity.transforms,
    pxpremm,
  )
}

/**
 * Create a a <path d="A..." /> or <ellipse /> element for the ARC or ELLIPSE
 * DXF entity (<ellipse /> if start and end point are the same).
 */
const ellipseOrArc = (
  cx,
  cy,
  majorX,
  majorY,
  axisRatio,
  startAngle,
  endAngle,
  flipX,
  config,
) => {
  const { pxpremm } = config || defaultConfig
  const rx = Math.sqrt(majorX * majorX + majorY * majorY)
  const ry = axisRatio * rx
  const rotationAngle = -Math.atan2(-majorY, majorX)

  const bbox = bboxEllipseOrArc(
    cx,
    cy,
    majorX,
    majorY,
    axisRatio,
    startAngle,
    endAngle,
    flipX,
  )

  if (
    Math.abs(startAngle - endAngle) < 1e-9 ||
    Math.abs(startAngle - endAngle + Math.PI * 2) < 1e-9
  ) {
    // Use a native <ellipse> when start and end angles are the same, and
    // arc paths with same start and end points don't render (at least on Safari)
    const converted = {
      //  String 类型 防止精度丢失
      cx: `${cx / pxpremm}`,
      cy: `${cy / pxpremm}`,
      rx: `${rx / pxpremm}`,
      ry: `${ry / pxpremm}`,
    }
    const element = `<g transform="rotate(${(rotationAngle / Math.PI) * 180
      } ${cx}, ${cy})">
      <ellipse cx="${converted.cx}" cy="${converted.cy}" rx="${converted.rx}" ry="${converted.ry}" />
    </g>`
    return { bbox, element }
  } else {
    const startOffset = rotate(
      {
        x: Math.cos(startAngle) * rx,
        y: Math.sin(startAngle) * ry,
      },
      rotationAngle,
    )
    const startPoint = {
      x: cx + startOffset.x,
      y: cy + startOffset.y,
    }
    const endOffset = rotate(
      {
        x: Math.cos(endAngle) * rx,
        y: Math.sin(endAngle) * ry,
      },
      rotationAngle,
    )
    const endPoint = {
      x: cx + endOffset.x,
      y: cy + endOffset.y,
    }
    const adjustedEndAngle =
      endAngle < startAngle ? endAngle + Math.PI * 2 : endAngle
    const largeArcFlag = adjustedEndAngle - startAngle < Math.PI ? 0 : 1
    const converted = {
      //  String 类型 防止精度丢失
      start: {
        x: `${startPoint.x / pxpremm}`,
        y: `${startPoint.y / pxpremm}`,
      },
      end: {
        x: `${endPoint.x / pxpremm}`,
        y: `${endPoint.y / pxpremm}`,
      },
      rx: `${rx / pxpremm}`,
      ry: `${ry / pxpremm}`,
    }
    const d = `M ${converted.start.x} ${converted.start.y} A ${converted.rx} ${converted.ry} ${(rotationAngle / Math.PI) * 180} ${largeArcFlag} 1 ${converted.end.x} ${converted.end.y}`
    const element = `<path d="${d}" />`
    return { bbox, element }
  }
}

/**
 * Compute the bounding box of an elliptical arc, given the DXF entity parameters
 */
const bboxEllipseOrArc = (
  cx,
  cy,
  majorX,
  majorY,
  axisRatio,
  startAngle,
  endAngle,
  // flipX,
) => {
  // The bounding box will be defined by the starting point of the ellipse, and ending point,
  // and any extrema on the ellipse that are between startAngle and endAngle.
  // The extrema are found by setting either the x or y component of the ellipse's
  // tangent vector to zero and solving for the angle.

  // Ensure start and end angles are > 0 and well-ordered
  while (startAngle < 0) startAngle += Math.PI * 2
  while (endAngle <= startAngle) endAngle += Math.PI * 2

  // When rotated, the extrema of the ellipse will be found at these angles
  const angles = []

  if (Math.abs(majorX) < 1e-12 || Math.abs(majorY) < 1e-12) {
    // Special case for majorX or majorY = 0
    for (let i = 0; i < 4; i++) {
      angles.push((i / 2) * Math.PI)
    }
  } else {
    // reference https://github.com/bjnortier/dxf/issues/47#issuecomment-545915042
    angles[0] = Math.atan((-majorY * axisRatio) / majorX) - Math.PI // Ensure angles < 0
    angles[1] = Math.atan((majorX * axisRatio) / majorY) - Math.PI
    angles[2] = angles[0] - Math.PI
    angles[3] = angles[1] - Math.PI
  }

  // Remove angles not falling between start and end
  for (let i = 4; i >= 0; i--) {
    while (angles[i] < startAngle) angles[i] += Math.PI * 2
    if (angles[i] > endAngle) {
      angles.splice(i, 1)
    }
  }

  // Also to consider are the starting and ending points:
  angles.push(startAngle)
  angles.push(endAngle)

  // Compute points lying on the unit circle at these angles
  const pts = angles.map((a) => ({
    x: Math.cos(a),
    y: Math.sin(a),
  }))

  // Transformation matrix, formed by the major and minor axes
  const M = [
    [majorX, -majorY * axisRatio],
    [majorY, majorX * axisRatio],
  ]

  // Rotate, scale, and translate points
  const rotatedPts = pts.map((p) => ({
    x: p.x * M[0][0] + p.y * M[0][1] + cx,
    y: p.x * M[1][0] + p.y * M[1][1] + cy,
  }))

  // Compute extents of bounding box
  const bbox = rotatedPts.reduce((acc, p) => {
    acc.expandByPoint(p)
    return acc
  }, new Box2())

  return bbox
}

/**
 * An ELLIPSE is defined by the major axis, convert to X and Y radius with
 * a rotation angle
 */
const ellipse = (entity, config) => {
  const { pxpremm } = config || defaultConfig
  const { bbox: bbox0, element: element0 } = ellipseOrArc(
    entity.x,
    entity.y,
    entity.majorX,
    entity.majorY,
    entity.axisRatio,
    entity.startAngle,
    entity.endAngle,
    config,
  )
  const { bbox, element } = addFlipXIfApplicable(entity, {
    bbox: bbox0,
    element: element0,
  })
  return transformBoundingBoxAndElement(
    bbox,
    element,
    entity.transforms,
    pxpremm,
  )
}

/**
 * An ARC is an ellipse with equal radii
 */
const arc = (entity, config) => {
  const { pxpremm } = config || defaultConfig
  const { bbox: bbox0, element: element0 } = ellipseOrArc(
    entity.x,
    entity.y,
    entity.r,
    0,
    1,
    entity.startAngle,
    entity.endAngle,
    entity.extrusionZ === -1,
    config,
  )
  const { bbox, element } = addFlipXIfApplicable(entity, {
    bbox: bbox0,
    element: element0,
  })
  return transformBoundingBoxAndElement(
    bbox,
    element,
    entity.transforms,
    pxpremm,
  )
}

const piecewiseToPaths = (k, knots, controlPoints, config) => {
  const { pxpremm } = config || defaultConfig
  const paths = []
  let controlPointIndex = 0
  let knotIndex = k
  while (knotIndex < knots.length - k + 1) {
    const m = multiplicity(knots, knotIndex)
    const cp = controlPoints.slice(controlPointIndex, controlPointIndex + k)
    if (k === 4) {
      const d = cp.reduce(
        (pre, cur, idx) =>
          idx === 1
            ? pre + ` C ${cur.x / pxpremm} ${cur.y / pxpremm}`
            : pre + ` ${cur.x / pxpremm} ${cur.y / pxpremm}`,
        'M',
      )
      paths.push(`<path d="${d}" />`)
    } else if (k === 3) {
      const d = cp.reduce(
        (pre, cur, idx) =>
          idx === 1
            ? pre + ` Q ${cur.x / pxpremm} ${cur.y / pxpremm}`
            : pre + ` ${cur.x / pxpremm} ${cur.y / pxpremm}`,
        'M',
      )
      paths.push(`<path d="${d}" />`)
    }
    controlPointIndex += m
    knotIndex += m
  }
  return paths
}

const bezier = (entity, config) => {
  const { pxpremm } = config || defaultConfig
  let bbox = new Box2()
  entity.controlPoints.forEach((p) => {
    bbox = bbox.expandByPoint(p)
  })
  const k = entity.degree + 1
  const piecewise = toPiecewiseBezier(k, entity.controlPoints, entity.knots)
  const paths = piecewiseToPaths(
    k,
    piecewise.knots,
    piecewise.controlPoints,
    config,
  )
  const element = `<g>${paths.join('')}</g>`
  return transformBoundingBoxAndElement(
    bbox,
    element,
    entity.transforms,
    pxpremm,
  )
}

/**
 * Switcth the appropriate function on entity type. CIRCLE, ARC and ELLIPSE
 * produce native SVG elements, the rest produce interpolated polylines.
 */
const entityToBoundsAndElement = (entity, config) => {
  switch (entity.type) {
    case 'CIRCLE':
      return circle(entity, config)
    case 'ELLIPSE':
      return ellipse(entity, config)
    case 'ARC':
      return arc(entity, config)
    case 'SPLINE': {
      const hasWeights = entity.weights && entity.weights.some((w) => w !== 1)
      if ((entity.degree === 2 || entity.degree === 3) && !hasWeights) {
        try {
          return bezier(entity, config)
        } catch (err) {
          return polyline(entity, config)
        }
      } else {
        return polyline(entity, config)
      }
    }
    case 'LINE':
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      return polyline(entity, config)
    }
    default:
      logger.warn('entity type not supported in SVG rendering:', entity.type)
      return null
  }
}

export default (parsed, config) => {
  const { lineStyle } = config || defaultConfig
  const lineWidth = lineStyle?.width || '0.1%'

  const entities = denormalise(parsed)
  const { bbox, elements } = entities.reduce(
    (acc, entity) => {
      const rgb = getRGBForEntity(parsed.tables.layers, entity)
      const boundsAndElement = entityToBoundsAndElement(entity, config)
      // Ignore entities like MTEXT that don't produce SVG elements
      if (boundsAndElement) {
        const { bbox, element } = boundsAndElement
        // Ignore invalid bounding boxes
        if (bbox.valid) {
          acc.bbox.expandByPoint(bbox.min)
          acc.bbox.expandByPoint(bbox.max)
        }
        const stroke = lineStyle?.color || rgbToColorAttribute(rgb)
        acc.elements.push(`<g stroke="${stroke}">${element}</g>`)
      }
      return acc
    },
    {
      bbox: new Box2(),
      elements: [],
    },
  )

  const getSVGConfig = (curbbox, curconfig) => {
    const { viewbox } = curconfig || defaultConfig
    if (isObject(viewbox)) {
      const isWarning =
        !viewbox.x || !viewbox.y || !viewbox.width || !viewbox.height
      if (isWarning) {
        logger.warn(
          'valid viewbox values need to be given, including x, y, width, and height:',
          viewbox,
        )
      }
      const x = parseInt(toNumber(viewbox.x) - curbbox.min.x)
      const y = parseInt(toNumber(viewbox.y) + curbbox.max.y)
      return {
        viewBox: viewbox,
        matrix: [1, 0, 0, -1, x, y],
      }
    }
    if (curbbox.valid) {
      return {
        viewBox: {
          x: curbbox.min.x,
          y: -curbbox.max.y,
          width: curbbox.max.x - curbbox.min.x,
          height: curbbox.max.y - curbbox.min.y,
        },
        matrix: [1, 0, 0, -1, 0, 0],
      }
    }
    return {
      viewBox: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      matrix: [1, 0, 0, -1, 0, 0],
    }
  }

  const { viewBox, matrix } = getSVGConfig(bbox, config) || {}

  return `<?xml version="1.0"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1"
  preserveAspectRatio="xMinYMin meet"
  viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"
  width="100%" height="100%"
>
  <g stroke="#000000" stroke-width="${lineWidth}" fill="none" vector-effect="non-scaling-stroke" transform="matrix(${matrix.join(',')})">
    ${elements.join('\n')}
  </g>
</svg>`
}
