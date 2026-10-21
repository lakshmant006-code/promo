# Starts the local ComfyUI used by "Redraw with AI" in the Motion Rig timeline.
# Uses the NVIDIA GPU; pass -Cpu to run on the processor instead (very slow).
param([switch]$Cpu)

$python = 'D:\ComfyUI\python_embeded\python.exe'
$main = 'D:\ComfyUI\ComfyUI\main.py'
$comfyArgs = @('-s', $main, '--windows-standalone-build', '--listen', '127.0.0.1', '--port', '8188', '--enable-cors-header', 'http://localhost:5173')
if ($Cpu) { $comfyArgs += '--cpu' }
& $python @comfyArgs
