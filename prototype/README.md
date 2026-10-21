# Prototype screen (for recording)

A separate screen for the prototype video. It is the original Motion Rig tablet UI, and it plays by
itself and loops. Nobody has to tap anything:

1. The camera button is offered, then tapped by a simulated finger.
2. "Try demo" starts a demo performer, Motion mode records a walk (REC chip and red edge).
3. The arrival sheet shows the drawings that were caught, then "Rig it".
4. Rig mode: the skeleton follows every drawing of the walk.
5. Pose mode: 3-2-1 countdown, then the Say hi wave with its skeleton.

The bushes overlay sits in front of the character throughout. It does not load or change the Motion
Rig app in `../public`.

```
node prototype/server.mjs      # http://localhost:5174
```
