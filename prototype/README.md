# Prototype screen (for the prototype video)

A separate screen: the original Motion Rig tablet UI with a **Prototype panel** beside it. Nothing plays by
itself and nothing is captioned.

```
node prototype/server.mjs      # http://localhost:5174
```

**Sequence tab.** Choose the scenes and their order (Ready, Open the camera, Demo performer, Record a walk,
Arrival sheet, Rig mode, Walk in, Pose and say hi), then set:

- **Walk-in:** left to right, right to left or in place; stops in the middle or keeps walking.
- **Look:** skeleton (Auto / On / Off), character art, foreground bushes, finger taps, say-hi loop, speed.

Press **Okay** to save the setup and hide the panel, then **Play** (the round button, or Space) to run the sequence once.
**Space** plays or stops, **H** hides the panel, **Esc** stops and brings it back. Your setup is remembered.

**Try a step** tab: show one scene on its own. The app in `../public` is not loaded or changed.

## Face screen: `http://localhost:5174/face/` (a separate screen)

A live face prototype: it opens straight from your webcam. Talk, blink, smile, raise your eyebrows, turn
your head, and the red-beanie character copies you. It is not part of the prototype sequence above.

- **Tracking:** MediaPipe Face Landmarker (478 points, 52 blendshapes), run locally with the model in `../models`.
  The camera only works on localhost or https, so run it from `node prototype/server.mjs`.
- **Retarget:** a neutral face is calibrated automatically at the start (**Calibrate** or **C** to redo it), then
  smoothed with a One Euro filter and a critically damped spring.
- **Face rig:** eyelids (each eye), gaze, eyebrows, mouth (talk, smile, frown, pucker), head turn, nod and tilt, cut
  from the front art so the original colours and edges are kept.
- **Scene:** the same playground and bushes as the prototype screen. **Z** or the **Wide shot / Zoom to face**
  button moves the camera between the full figure and the face.
- **On screen:** only the tracking strip: Camera, Face tracker, Retarget, Face rig, Character.

Keys: **C** calibrate, **M** mirror, **Z** zoom. Open with `?wide` to start on the wide shot, or `?demo` for a
scripted face with no camera. If you turn your head and the character turns the wrong way, press **M**.
