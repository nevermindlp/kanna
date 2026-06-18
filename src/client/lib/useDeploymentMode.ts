import { useEffect, useState } from "react"

export function useDeploymentMode() {
  const [isCloudDeployment, setIsCloudDeployment] = useState(false)

  useEffect(() => {
    let active = true
    void fetch("/auth/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { mode?: string } | null) => {
        if (active && payload?.mode === "multiuser") {
          setIsCloudDeployment(true)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  return isCloudDeployment
}
