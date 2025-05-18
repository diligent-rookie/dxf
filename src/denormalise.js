import cloneDeep from 'lodash/cloneDeep'

import logger from './util/logger'

export default (parseResult) => {
  const blocksByName = parseResult.blocks.reduce((acc, b) => {
    acc[b.name] = b
    return acc
  }, {})

  const gatherEntities = (entities, transforms) => {
    let current = []
    entities.forEach((e) => {
      if (e.type === 'INSERT') {
        const insert = e
        const block = blocksByName[insert.block]
        if (!block) {
          logger.error('no block found for insert. block:', insert.block)
          return
        }

        const rowCount = insert.rowCount ?? 1
        const columnCount = insert.columnCount ?? 1
        const rowSpacing = insert.rowSpacing ?? 0
        const columnSpacing = insert.columnSpacing ?? 0
        const rotation = insert.rotation ?? 0

        // It appears that the rectangular array is affected by rotation, but NOT by scale.
        let rowVec, colVec
        if (rowCount > 1 || columnCount > 1) {
          const cos = Math.cos((rotation * Math.PI) / 180)
          const sin = Math.sin((rotation * Math.PI) / 180)
          rowVec = { x: -sin * rowSpacing, y: cos * rowSpacing }
          colVec = { x: cos * columnSpacing, y: sin * columnSpacing }
        } else {
          rowVec = { x: 0, y: 0 }
          colVec = { x: 0, y: 0 }
        }

        // For rectangular arrays, add the block entities for each location in the array
        for (let r = 0; r < rowCount; r++) {
          for (let c = 0; c < columnCount; c++) {
            // Adjust insert transform by row and column for rectangular arrays
            const t = {
              x: insert.x + rowVec.x * r + colVec.x * c,
              y: insert.y + rowVec.y * r + colVec.y * c,
              scaleX: 1,
              scaleY: 1,
              scaleZ: insert.scaleZ,
              extrusionX: insert.extrusionX,
              extrusionY: insert.extrusionY,
              extrusionZ: insert.extrusionZ,
              rotation: insert.rotation,
            }
            // Add the insert transform and recursively add entities
            const transforms2 = transforms.slice(0)
            transforms2.push(t)

            // Use the insert layer
            const blockEntities = block.entities.map((be) => {
              const be2 = cloneDeep(be)
              be2.layer = insert.layer
              // https://github.com/bjnortier/dxf/issues/52
              // See Issue 52. If we don't modify the
              // entity coordinates here it creates an issue with the
              // transformation matrices (which are only applied AFTER
              // block insertion modifications has been applied).
              // 将 scaleX scaleY 缩放转换为点的坐标，而不是进行实体放大或缩小
              switch (be2.type) {
                case 'LINE': {
                  be2.start.x = (be2.start.x - block.x) * (insert.scaleX || 1)
                  be2.start.y = (be2.start.y - block.y) * (insert.scaleY || 1)
                  be2.end.x = (be2.end.x - block.x) * (insert.scaleX || 1)
                  be2.end.y = (be2.end.y - block.y) * (insert.scaleY || 1)

                  break
                }
                case 'LWPOLYLINE':
                case 'POLYLINE': {
                  be2.vertices.forEach((v) => {
                    v.x = (v.x - block.x) * (insert.scaleX || 1)
                    v.y = (v.y - block.y) * (insert.scaleY || 1)
                  })
                  break
                }
                case 'CIRCLE':
                case 'ELLIPSE':
                case 'ARC': {
                  be2.x = (be2.x - block.x) * (insert.scaleX || 1)
                  be2.y = (be2.y - block.y) * (insert.scaleY || 1)
                  break
                }
                case 'SPLINE': {
                  be2.controlPoints.forEach((cp) => {
                    cp.x = (cp.x - block.x) * (insert.scaleX || 1)
                    cp.y = (cp.y - block.y) * (insert.scaleY || 1)
                  })
                  break
                }
              }
              return be2
            })
            current = current.concat(gatherEntities(blockEntities, transforms2))
          }
        }
      } else {
        // Top-level entity. Clone and add the transforms
        // The transforms are reversed so they occur in
        // order of application - i.e. the transform of the
        // top-level insert is applied last
        const e2 = cloneDeep(e)
        e2.transforms = transforms.slice().reverse()
        current.push(e2)
      }
    })
    return current
  }

  return gatherEntities(parseResult.entities, [])
}
