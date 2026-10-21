# Prototype screen (for recording)

A separate screen for the prototype video. It shows the original Motion Rig tablet look and plays the
**Walk** cycle and the **Say hi** wave with the rig skeleton on top, with the bushes overlay in front.
It does not load or change the Motion Rig app in `../public`.

```
node prototype/server.mjs      # http://localhost:5174
```

- Open `http://localhost:5174/#hi` to start on Say hi.
- The small bar under the tablet has Walk / Say hi, Skeleton, Character, Travel, Loop, Speed and Replay.
  Press **H** (or open with `?clean`) to hide it while recording.
