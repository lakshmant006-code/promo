# Prototype screen (for the prototype video)

A separate screen: the original Motion Rig tablet UI with a **Prototype panel** beside it. Nothing plays by
itself and nothing is captioned.

```
node prototype/server.mjs      # http://localhost:5174
```

**Sequence tab.** Choose the scenes and their order (Ready, Open the camera, Demo performer, Record a walk,
Arrival sheet, Rig mode, Walk in, Pose and say hi, Face zoom and tracking), then set:

- **Walk-in:** left to right, right to left or in place; stops in the middle or keeps walking.
- **Face:** live webcam or a simulated face; starts wide and zooms in, or starts on the face; time on the face;
  zoom back out at the end; the tracking strip on or off. If the camera is not available (for example in a
  published page) it falls back to the simulated face without any message.
- **Look:** skeleton (Auto / On / Off), character art, foreground bushes, finger taps, say-hi loop, speed.

Press **Okay** to save the setup and hide the panel, then **Play** (the round button, or Space) to run the sequence once.
**Space** plays or stops, **H** hides the panel, **Esc** stops and brings it back. Your setup is remembered.

**Try a step** tab: show one scene on its own. The app in `../public` is not loaded or changed.

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
