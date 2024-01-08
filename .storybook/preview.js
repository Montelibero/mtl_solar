import { makeDecorator } from "@storybook/addons"
import React from "react"
import { HashRouter as Router } from "react-router-dom"
import { MainErrorBoundary } from "../src/Generic/components/ErrorBoundaries"
import ViewLoading from "../src/Generic/components/ViewLoading"
import { ContextProviders } from "../src/App/bootstrap/context"
import "../src/App/i18n"

const contextProviders = makeDecorator({
  wrapper: storyFn => React.createElement(Router, {}, React.createElement(ContextProviders, {}, storyFn()))
})

const errorBoundary = makeDecorator({
  wrapper: storyFn => React.createElement(MainErrorBoundary, {}, storyFn())
})

const suspense = makeDecorator({
  wrapper: storyFn => React.createElement(React.Suspense, { fallback: React.createElement(ViewLoading) }, storyFn())
})

export const decorators = [contextProviders, errorBoundary, suspense]
