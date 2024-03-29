import React from "react"
import Button from "@material-ui/core/Button"
import { MainErrorBoundary } from "../components/ErrorBoundaries"
import { VerticalLayout } from "~Layout/components/Box"

function Failing() {
  const [failing, setFailing] = React.useState(false)
  const fail = React.useCallback(() => setFailing(true), [])
  if (failing) {
    throw new Error("Exception time!")
  }
  return (
    <VerticalLayout alignItems="center" justifyContent="center">
      <Button onClick={fail} variant="contained">
        Throw
      </Button>
    </VerticalLayout>
  )
}

export default { title: "MainErrorBoundary" }
export const MainErrorBoundaryExample = () => (
  <VerticalLayout height="400px" justifyContent="center">
    <MainErrorBoundary>
      <Failing />
    </MainErrorBoundary>
  </VerticalLayout>
)
