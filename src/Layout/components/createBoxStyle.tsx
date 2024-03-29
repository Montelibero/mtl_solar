import React from "react"

const removeNullValueProps = (object: { [key: string]: any }) => {
  return Object.keys(object).reduce((result, propKey) => {
    const propValue = object[propKey]
    return propValue !== null ? { ...result, [propKey]: propValue } : result
  }, {})
}

interface SizingStyles {
  width?: React.CSSProperties["width"]
  height?: React.CSSProperties["height"]
  minWidth?: React.CSSProperties["minWidth"]
  maxWidth?: React.CSSProperties["maxWidth"]
  minHeight?: React.CSSProperties["minHeight"]
  maxHeight?: React.CSSProperties["maxHeight"]
  padding?: React.CSSProperties["padding"]
}

const createSizingStyle = ({ width, height, minWidth, maxWidth, minHeight, maxHeight, padding }: SizingStyles) => {
  return {
    padding,
    width,
    height,
    maxWidth,
    minWidth,
    maxHeight,
    minHeight
  }
}

interface FlexParentStyles {
  alignItems?: React.CSSProperties["alignItems"]
  justifyContent?: React.CSSProperties["justifyContent"] | "start" | "end"
  wrap?: React.CSSProperties["flexWrap"]
}

const createFlexParentStyle = ({ alignItems, justifyContent, wrap }: FlexParentStyles) => {
  if (justifyContent === "start") {
    justifyContent = "flex-start"
  }
  if (justifyContent === "end") {
    justifyContent = "flex-end"
  }
  if (alignItems === "start") {
    alignItems = "flex-start"
  }
  if (alignItems === "end") {
    alignItems = "flex-end"
  }
  return {
    alignItems,
    justifyContent,
    flexWrap: wrap
  }
}

interface FlexChildStyles {
  alignSelf?: React.CSSProperties["alignSelf"]
  basis?: number | string
  fixed?: boolean
  grow?: boolean | number
  order?: React.CSSProperties["order"]
  shrink?: boolean | number
}

const createFlexChildStyle = ({ alignSelf, basis, fixed, grow, order, shrink }: FlexChildStyles) => {
  const style: React.CSSProperties = {
    flexBasis: basis
  }

  if (typeof grow === "boolean") {
    style.flexGrow = grow ? 1 : 0
  }
  if (typeof grow === "number") {
    style.flexGrow = grow
  }
  if (typeof order !== "undefined") {
    style.order = order
  }
  if (typeof shrink === "boolean") {
    style.flexShrink = shrink ? 1 : 0
  }
  if (typeof shrink === "number") {
    style.flexShrink = shrink
  }
  if (fixed) {
    style.flexGrow = 0
    style.flexShrink = 0
  }
  if (alignSelf) {
    style.alignSelf = alignSelf
  }
  return style
}

interface TextStyles {
  fontSize?: React.CSSProperties["fontSize"]
  fontWeight?: React.CSSProperties["fontWeight"]
  textAlign?: React.CSSProperties["textAlign"]
}

function createTextStyle({ fontSize, fontWeight, textAlign }: TextStyles) {
  return {
    fontSize,
    fontWeight,
    textAlign
  }
}

export type BoxStyles = SizingStyles &
  FlexParentStyles &
  FlexChildStyles &
  TextStyles & {
    display?: React.CSSProperties["display"]
    hidden?: boolean
    margin?: React.CSSProperties["margin"]
    overflow?: React.CSSProperties["overflow"]
    overflowX?: React.CSSProperties["overflow"]
    overflowY?: React.CSSProperties["overflow"]
    position?: React.CSSProperties["position"]
  }

const createBoxStyle = (styleProps: BoxStyles) => {
  const { hidden = false, margin, overflow = "visible", overflowX, overflowY } = styleProps

  const style = {
    boxSizing: "border-box",
    margin,
    overflow,
    overflowX,
    overflowY,
    ...(hidden ? { display: "none" } : {}),
    ...createSizingStyle(styleProps),
    ...createFlexParentStyle(styleProps),
    ...createFlexChildStyle(styleProps),
    ...createTextStyle(styleProps)
  }
  if (styleProps.display) {
    style.display = styleProps.display
  }
  if (styleProps.position) {
    style.position = styleProps.position
  }
  return removeNullValueProps(style)
}

export default createBoxStyle
