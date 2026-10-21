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

## Face screen: `http://localhost:5174/face/`

A second screen on the same tablet UI, for recording a live face performance. The front red-beanie
character copies your face from the webcam:

- **Tracking:** MediaPipe Face Landmarker (478 points, 52 blendshapes), run locally with the model in `../models`.
  Open it from `node prototype/server.mjs` on localhost; browsers only allow the camera on localhost or https.
- **Retarget:** the first second of a neutral face is calibrated automatically (tap **Calibrate**, or press **C**,
  to redo it), values are smoothed with a One Euro filter, then a critically damped spring.
- **Face rig:** eyelids (each eye), gaze, eyebrows (raise, lower, inner), mouth (talk, smile, frown, pucker), head
  turn, nod and tilt. The parts are cut from the front art in `assets/` (`base.png` is the head with the face
  features removed), so the original colours and edges are kept.
- **On screen:** only a thin pipeline strip: Camera, Face tracker, Retarget, Face rig, Character.

The scene is the same as the first prototype screen (the playground background and the bushes in front), so the
two screens cut together. The screen opens zoomed on the face; **Z**, or the **Wide shot / Zoom to face** button in
the strip, pushes the camera out to the full scene with the red beanie standing, or back in, over about 1.6 s.
Open with `?wide` to start on the wide shot.

Keys: **C** calibrate, **M** flip the mirror, **Z** zoom. `?demo` plays a scripted face (no camera) to check the rig.
