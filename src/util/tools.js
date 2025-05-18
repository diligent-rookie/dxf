// 判断是否有效对象
export const isObject = (params) => {
  return (
    Object.prototype.toString.call(params) === '[object Object]' &&
    Object.keys(params).length
  )
}
