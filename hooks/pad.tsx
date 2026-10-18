// A press pad for the desktop: a region that draws nothing, laid over a glass tile. The desktop gives a Client
// pointer events but draws no hover of its own, so the glass is all that shows. A left press posts once;
// register.tsx answers it at `ui.message`, keyed by the pad's `key`. The first click into an unfocused pane
// reaches the pad as a release with no press before it, so that release counts as the press. It draws one
// empty row per row it covers, since an empty region shrinks to a single row on the desktop.

import type { ClientModule } from 'claude-code'

type PadProps = { rows: number }

const Pad: ClientModule<PadProps, true> = (props, surface) => {
  if (surface.state === undefined) {
    let isDown = false
    surface.onPointer(e => {
      if ((e.button ?? 'left') !== 'left') return
      if (e.type === 'down') {
        isDown = true
        surface.post({ press: true })
      } else if (e.type === 'up') {
        if (!isDown) surface.post({ press: true })
        isDown = false
      } else if (e.type === 'leave') isDown = false
    })
    surface.setState(true)
  }
  const { Box } = surface.elements
  return (
    <Box flexDirection="column" width="100%" height={props.rows}>
      {Array.from({ length: props.rows }, (_, i) => <Box key={`r${i}`} width="100%" height={1} flexShrink={0} />)}
    </Box>
  )
}

export default Pad
