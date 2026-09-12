$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$audioDirectory = Join-Path $projectRoot '.local'
New-Item -ItemType Directory -Path $audioDirectory -Force | Out-Null
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $englishVoice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'en-US' } | Select-Object -First 1
    if (-not $englishVoice) { throw 'An English Windows speech voice is required.' }
    $synth.SelectVoice($englishVoice.VoiceInfo.Name)
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $synth.SetOutputToWaveFile((Join-Path $audioDirectory 'test-question.wav'), $format)
    $synth.Speak('Could you explain how you conducted the thematic analysis? We did not find a statistically significant difference between the two groups. There were twenty four participants.')
} finally { $synth.Dispose() }
Write-Output 'Created .local/test-question.wav (synthetic English, PCM16 mono 16 kHz).'
