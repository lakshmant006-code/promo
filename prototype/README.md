# Prototype screen (for the prototype video)

A separate screen: the original Motion Rig tablet UI with a **Prototype panel** beside it. Nothing plays by
itself. You choose what to show.

```
node prototype/server.mjs      # http://localhost:5174
```

**Steps** (tap to show one, each sets up what came before it): Ready, Open the camera, Demo performer,
Record a walk, Arrival sheet, Rig mode, Walk in, Pose and say hi, Say hi, Walk in then say hi,
Play the whole flow, Stop and reset.

**Walk-in:** direction (left to right, right to left, in place) and what happens on arrival (stops in the
middle, or keeps walking across).

**Show:** skeleton (Auto / On / Off), character art, foreground bushes, captions, finger taps, say-hi loop, speed.
Captions use the wording of the Motion Rig app's own tips, one per step. Everything runs slower by default
(0.6×); the Speed slider goes down to 0.15× and slows the pauses, finger and countdown as well as the motion.

Press **H** to hide the panel for a clean screen, **S** to switch the skeleton on or off (or open with `?clean`). Open with `#hi`, `#rig` and so
on to start on a step. The app in `../public` is not loaded or changed.
