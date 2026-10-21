# Motion Rig (prototype)

A Procreate-style screen with a "Motion Rig" extension. You perform in front of the camera, and a 2D character copies your body joints (shoulders, elbows, wrists, hips, knees, ankles) and your face (blinks, mouth, smile, brows, head tilt). It all runs locally. The tracking models are stored in `models/`, so nothing is sent to the cloud.

## Run

```
npm install
npm start
```

Open http://localhost:5173 in your laptop browser. The app appears inside an iPad Pro mockup and uses the laptop webcam. Every time a file in `public/` is saved, the page reloads by itself.


## Use

The screen copies Procreate's own interface. Motion Rig is added as one extra tab in the Actions (wrench) menu.

- Paint, smudge and erase on the canvas. The left sidebar sets brush size and opacity, the square is the eyedropper, and below it are undo and redo (Ctrl+Z / Ctrl+Shift+Z also work).
- **Actions › Prefs**: light interface, right-hand interface, brush cursor and Size & Opacity sidebar all work.
- **Actions › Canvas › Reference**: shows the camera window with the tracked skeleton.
- **Actions › Rig** (the extension):
  - **Capture**: start the camera or the demo motion, record the performance, and set smoothing and character size.
  - **Character**: "Use drawn character (Beanie)" turns your drawing into the puppet. Switch it off to use the basic figure, where you can upload a PNG for each body part exported from Procreate. Draw limbs pointing down, with the top of the image at the joint the part hangs from.
  - **Joints**: live joint angles and face meters.
- **Layers**: the character is its own "Motion Rig" layer above Layer 1.

## Characters from your drawings

**Actions › Rig › Character**
- **New character from a drawing…**: pick a full-body PNG, ideally standing in an A-pose. A white background is removed automatically. The joints are detected with the pose model, or placed from a template if it can't find a body. Drag any joint that's off, then tap **Build character**. The drawing is cut into parts automatically.
- **Edit joints**: adjust the joints of the current character.
- **Layered SVG**: traced vector parts, one named group per body part, each with its pivot (`data-pivot` and `transform-origin`), plus a hidden "Rig guide" layer. For After Effects, Rive, Figma or Illustrator.
- **Layered PSD**: one layer per body part. Open it in Procreate, fix or redraw a part (for example, the torso hidden under an arm), export PSD, then use **Import layered PSD…** to bring it back. Layers are matched by name: Head, Torso, Upper arm R/L, Forearm R/L, Thigh R/L, Shin R/L.

How the motion stays smooth:
- Each part is covered by a fine mesh. Near each joint the mesh blends between the two bones, so elbows, knees and shoulders bend instead of splitting.
- Edges of a part that were hidden under another part get an ink line, so the body keeps its outline when a limb moves away.
- Camera joints pass through a One Euro filter, which removes jitter without adding lag.
- Rendering uses WebGL2 with mipmapped textures when available, and a canvas fallback otherwise.

**Red beanie** (`public/characters/redcap.json`, the default character) is your vector character. Its front view is the open-arms pose from your SVG (`redcap-welcome.svg`), rendered to `redcap.png`. Open arms keep the sleeves and hands clear of the body, so the automatic cut is clean. The earlier arms-down front view is kept as `redcap-armsdown.png`, and the full turnaround sheet as `redcap-turnaround.svg`. Because it's flat colour without outlines, `"edges": "shade"` gives hidden edges a slightly darker shade of the part's colour instead of a black line. Its face settings make blinks use the skin colour as an eyelid, and leave the beard alone when the mouth opens.

`public/characters/beanie.json` is the line-art sample: joint positions, optional hand-drawn part outlines (`pieces`), and face points for blinks and the mouth.

## Takes: capture, keep, rig (new)

The artist-facing flow, built for 2D animators and doodle artists rather than technical animators.

1. **Capture.** Start the camera (or the demo motion). A capture bar appears at the bottom of the canvas.
   - **Pose**: tap the button, get into position during the 3-second countdown, and one pose is captured.
   - **Motion**: tap to record, tap again to stop. Recording stops on its own at 10 seconds. While recording, the rig follows the camera closely; clean-up happens afterwards.
2. **Arrival sheet.** What you captured appears as drawings.
   - For a motion, the app picks the drawings where you move the most. **Few ↔ Many** changes how many, and tapping a drawing leaves it out.
   - **Keep** puts it in Layers as a take. **Rig it** keeps it and opens Rig mode. **Retake** throws it away.
3. **Layers breakdown** (panel on the right, also listed in the Layers popover).
   - Each take is a group with one row per frame. Drag a row to reorder.
   - When two frames that weren't neighbours in the capture end up side by side and the pose changes more than a normal step, an orange **Big jump** note appears between them. Choose **Add in-between** (a blended frame, marked "made for you") or **Leave it**.
   - Play loops the take on the canvas. The previous frame shows faintly underneath (onion skin).
4. **Rig mode** (the Rig button). The same panel becomes the part tree: Head, Body, Arm R/L (upper arm, forearm & hand), Leg R/L (thigh, shin & foot), colour-coded.
   - **Bones** (modelled on TVPaint's rigging tool): every bone shows as a translucent blue diamond, widest near its joint; the selected part is darker. Tap a bone to select its part.
   - **Rotate circle**: a grey circle around the selected part's joint. Drag anywhere on the canvas to turn the part around that joint on the current frame; a shaded wedge shows how far. Children follow (turning the upper arm carries the forearm, turning the body carries head and arms). **Undo my bends on this frame** removes the changes.
   - **Animate / Rig** (like TVPaint's two modes): **Animate** (blue bones) changes only the current frame; **Rig** (amber bones) changes every frame of the take, for example making a forearm longer for the whole animation. **Undo my changes on this frame** and **Reset … on every frame** take them back.
   - **Turn / Stretch brush**: Turn rotates the selected part around its joint. Stretch makes an arm or leg (or one segment of it) longer or shorter: drag along the limb; a percentage shows while dragging (40% to 220%). The drawing stretches along the bone.
   - **Joint balls**: round elbows, knees, shoulders and hips painted in the character's own colours (sampled from the drawing, with the same soft shading and grain). They are invisible in the pose as drawn and fade in as a joint bends or stretches, so the limb never looks broken. Switch them off in **Rig Lab › Deformation › Joint balls** to compare.
   - **In-betweens** stay a blend of the two frames they were made from, so they follow when you change those frames.
   - **Background and Transform**: the scene is a background layer (**Playground** in Layers, with Replace). The Transform tool (arrow in the top bar) shows a box around the character: drag to move it, drag a corner to resize it. This applies to the live character and every frame of every take, and is remembered.
   - **Clean-up** (Sketchy ↔ Clean) removes the wobble the camera picked up.
   - **Feel** cards: Snappy (holds, then moves quickly), Smooth (one flowing line), Floaty (trails a little behind, then settles).
   - Settings flow down the tree: change an arm and its parts follow, until a part gets its own settings (blue dot; **Match the rest** resets it).
   - **Preview window** (top right): loops just the selected part. **Before** plays the raw capture, **After** plays the cleaned-up take with its feel.

Code: `public/js/take.js`. Console handle: `window.takes` (state, `jumpInfo()`, `sample(t, 'before'|'after')`).

## Feedback and guidance (build 4)

- **Capture bar is always there.** With the camera off it offers **Start camera** and **Try demo**; once live it shows a status light (green when you're tracked, amber "Step into view" when not), Pose / Motion, the shutter, and × to turn the camera off. It steps aside while the Transform tool is open.
- **Countdown and recording.** The countdown beats in the sky above the character with "Get into your pose". While recording, a **REC** chip with the time sits at the top and the canvas gets a red edge.
- **Arrival sheet.** **Preview** plays the drawings you picked on the canvas, each held until the next. Left-out drawings are tagged "Left out". The strip fades at the edge when it scrolls.
- **Frames.** Dragging lifts the row and opens a slot where it will land; jump notes step aside while you drag. After a move, a toast says how many spots won't flow. Tapping a jump note shows that spot on the canvas. While playing, the frame being shown lights up green (in the list and the Rig strip).
- **Rig panel.** Animate / Rig and Turn / Stretch sit in a toolbar that stays at the top while you scroll. The part tree folds: groups open when you pick something inside them. Rig mode adds an amber edge to the panel and a toast. Clean-up shows its value as you drag.
- **On the canvas.** Hovering a bone highlights it and shows its name; the cursor says what will happen (pointer to pick, grab to turn, ↔ to stretch).
- **Undo / redo** in a take: the arrows in the panel header, the sidebar arrows, or Ctrl+Z / Ctrl+Shift+Z undo every rig change (turns, stretches, clean-up, feel, reordering, in-betweens).
- **Shortcuts** in the Rig panel: **T** Turn, **S** Stretch, **A** Animate, **R** Rig.
- **Tooltips** on every control: hover with a mouse or Pencil, or long-press with a finger.
- **First-use hints** for capturing, frames, the rig and Transform. Each shows once; "Got it" hides it for good (clear site data to see them again).
- **Transform** shows the size as a percentage while resizing.

## Animation Assist (frames)

Turn it on with **Actions › Canvas › Animation Assist** or **Rig › Capture frames**.
- **Add Frame** (or Space) captures the current pose. **Auto-capture** grabs frames at the chosen FPS while you perform.
- **Play** loops the frames. **Smooth in-betweens** blends between poses. Onion skin shows the previous frame.
- **Export**:
  - **Frames as PSD layers**: one layer per frame, so in Procreate you open it and turn on Animation Assist.
  - **Sprite sheet PNG**.
  - **Video**.
  - **AI pack (ZIP)**: everything needed to redraw every frame cleanly in your style with Stable Diffusion, run locally in ComfyUI or Automatic1111. Per frame:
    - `frames/`: the posed drawing, used as the img2img input.
    - `pose/`: an OpenPose skeleton, for ControlNet OpenPose.
    - `lineart/`: white-on-black outlines, for ControlNet Lineart.

    The pack also includes your drawing in `reference/` for IP-Adapter, the keypoints in `poses_openpose.json`, and a `README.txt` with the node setup, settings and prompts.

## Hold a pose to capture

**Actions › Rig › Capture**: switch on **Hold a pose to capture**. Strike a pose and hold still for the set time (1.2 s by default) while a ring fills up. One frame is captured, and you move to the next pose before another can be taken.

**Save into a folder for Procreate**: in the Animation Assist **Settings**, choose **Save frames to folder** (Chrome or Edge). Every capture writes `frame_0001.png`, `frame_0002.png` and so on, and keeps an up-to-date `animation.psd` with one layer per frame. Pick a folder in iCloud Drive and the files appear on the iPad, where Procreate opens the PSD with Animation Assist.

## Rig check (first camera start)

The first time the camera starts, a **Rig check** card walks you through six test poses: arms up, arms out, head tilted each way, elbows bent, knee lifted. Hold each pose until the ring fills. For each pose the app finds where the character chops (joints bent far from the drawing, shown in red) and has the local AI repaint only those spots. Each repair is saved as a **joint fix** for that joint and angle. While you animate, a fix fades in whenever that joint bends close to the tested angle, so the break is covered live. You can still animate while the AI works in the background.

Run it again any time from **Actions › Rig › Run rig check**. **Use AI joint fixes** switches the fixes on and off, and **Clear joint fixes** removes them. Fixes are saved per character in this browser.

## Redraw with AI (local)

The timeline's **Export › Fix gaps with AI** repaints only the chopped joints of each frame and leaves every other pixel as you drew it. **Settings › Show gap areas** previews them in red. **Export › Redraw with AI** sends each frame to ComfyUI on this laptop (Stable Diffusion 1.5 / DreamShaper 8, with ControlNet OpenPose and Lineart). The redrawn frames come back into the timeline, and playback and exports then use them. **Settings › Show AI redraws** switches between the redrawn and original frames, and **AI redraw strength** controls how much it may change.

Start ComfyUI first (installed in `D:\ComfyUI`):

```
powershell -ExecutionPolicy Bypass -File scripts\start-comfyui.ps1
```

It needs the NVIDIA GPU. On the processor alone, one frame takes about an hour.

## Character views and walking

The Red beanie carries all four views from your character sheet: front (open arms), three-quarter, side and back. They share one rig, so the same pose shows in whichever view is active; the other views are built the first time they're used.

- **Rig Lab › View** picks the view: **Auto** follows how far your body turns from the camera (the readout shows the turn angle), or lock **Front**, **¾**, **Side** or **Back**. **Face left** mirrors the drawn view, and **Invert turn direction** flips which way a turn maps.
- The side view shows only one arm and leg in the art, so the far ones are darker copies drawn behind the body, and the near sleeve is cut out by hand-drawn regions (`views.side.regions` in `redcap.json`) with the torso repainted behind it. Other characters can use the same `views`, `nearSide`, `regions` and `erase` options.
- **Test poses › Walk cycle** (**Walk in place**, **March**, with speed and stride sliders) drives a profile walk: opposite arm and leg swing, knees bend as the leg passes through, and the body bobs and leans into each step. It runs through the same primary springs as camera tracking, so it gets the same ease in and out.

## Rig Lab (prototyping panel)

A panel docked on the right of the laptop screen, beside the iPad, for testing deformation and motion. Open or close it with the **Rig Lab** button.

- **Deformation:**
  - **Skinning method:** *Rigid cutout* (each vertex follows one bone, for comparison), *Weighted* (two-bone blend at joints) or *Weighted + shape* (adds Delta Mush shape preservation after skinning, so joints keep their volume).
  - **Overlapping hidden artwork:** rebuilds the parts with or without artwork under the joints.
  - **Preserve rigid features:** pins the face, hands and shoes.
- **Motion:**
  - **Primary springs:** critically damped, for ease in and out with no overshoot, on a fixed 120 Hz step.
  - Motion feel presets, smoothing and follow-through.
  - **Secondary motion amount** (30% = as designed): cloth springs on the jacket hem (38% rigid), sleeve cuffs (50%) and trouser cuffs (35%), with cloth bounce.
- **Views:** skeleton, mesh wireframe and weights.
- **Test poses:** rest, 45° head tilts, arm lifts, arms up and down, elbows crossed and bent, deep squat, plus slow sweeps (head tilt, arm lift, squat). Tests drive the rig through its springs, just like tracking. **Make corrective for this pose** has the local AI repair the chopped joints and saves the result as a joint fix.
- **Test plan:** the six-step checklist, saved in this browser.
- **Copy test configuration:** copies all settings as text.

For renders from the command line: `?testpose=armsup|cross|squat|down|rest` freezes a pose, and `?skin=rigid|weighted|mush` picks the skinning method.

## Files

- `server.js`: local server and live reload
- `public/js/tracker.js`: camera tracking with MediaPipe pose and face models
- `public/js/rig.js`: bone angles, forward kinematics, character drawing, joint angles
- `public/js/puppet.js`: cuts the drawing into parts, mesh skinning, WebGL and canvas renderers
- `public/js/export.js`: layered SVG and PSD export and PSD import
- `public/js/editor.js`: joint editor
- `public/js/timeline.js`: Animation Assist frames, playback and export
- `public/js/aipack.js`: AI pack (OpenPose, line art, ZIP)
- `public/js/comfy.js`: Redraw with AI and gap fixing (inpainting) through the local ComfyUI
- `public/js/rigcheck.js`: guided rig check
- `public/js/correctives.js`: saved joint fixes, blended in live
- `scripts/start-comfyui.ps1`: starts ComfyUI for the app
- `public/js/filters.js`: One Euro jitter filter
- `public/js/motion.js`: primary spring dynamics (fixed 120 Hz step)
- `public/js/cloth.js`: secondary cloth springs
- `public/js/deform.js`: rigid cutout and Delta Mush skinning variants, feature pins
- `public/js/rigview.js`: mesh and weights views
- `public/js/lab.js`: Rig Lab panel, test bench and walk cycle
- `public/js/demo.js`: fake performer for testing
- `public/js/paint.js`: brush, smudge, eraser, undo
- `public/js/main.js`: Procreate UI wiring, the Rig tab, character parts, recording
- `public/js/joints.js`: colour-matched joint balls
- `public/js/ui.js`: tooltips and first-use hints
- `public/js/take.js`: takes: pose and motion capture, arrival sheet, Layers breakdown, jump marks, Rig mode, pose brush, part preview

## Build 5: canvas first

The layout was rebuilt around the canvas. Nothing was removed; controls moved.

- **Camera** is the icon at the top left of the bar. It opens the capture bar (Pose / Motion, shutter). **?** next to it shows every tip again.
- **A capture lands straight in the filmstrip** along the bottom (no arrival sheet). A motion replays once, and a toast offers **Undo** (this replaces Retake).
- **Filmstrip**: blue outline = the frame you are editing. Drag a drawing sideways to reorder, **x** removes it, **−/+** picks fewer or more drawings, a **tear** marks a jump (tap it to add an in-between, tick to leave it).
- **Tap a limb** and a small pill appears next to it: **Turn / Stretch** and **Animate (this frame) / Rig (every frame)**. On the canvas, drag the **circle** to turn and the **diamond** to stretch. T, S, A and R still work.
- The status pill says what a change reaches, with **Apply to all frames** (moves this frame's change into Rig) and **Reset**.
- Slim **Feel strip** on the right: three tiles that animate the feel (grey = what the camera caught, black = the result), Clean-up, **Path** (dots close = slow) and **Original** (hold to see the capture).
- **Parts** opens the full part tree (settings pass down from the part above).
- Small tips appear by themselves, up to three at a time, once each. The preview window was replaced by Original.
