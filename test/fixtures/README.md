# Test fixtures

## `gladys-feature-table.json`

The category/type couples, units and poll frequencies the Gladys core knows, extracted from its code (see the
`source` field). Used by `test/gladys-rules.test.js`. Do not edit by hand.

## `devices.js`: device profiles

What each model answers to the commands of `src/tv/commands.js`, rendered by `test/helpers/simulator.js`.
Serial numbers and MAC addresses are invented (MACs in the documentation range `00:00:5e:00:53:xx`, RFC 7042).

Where the formats come from:

| Output                                                        | Source                                                                                                                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getprop` values per model                                    | python-androidtv `tests/test_basetv_sync.py` (`DEVICE_PROPERTIES_*`: Amazon AFTT, Google Chromecast, Sony BRAVIA 4K GB, NVIDIA SHIELD Android TV 11/12/13), real values reported by users |
| `ip addr show … \| grep ether`                                | python-androidtv `WIFIMAC_*` / `ETHMAC_*`                                                                                                                                                 |
| `mCurrentFocus`, `mFocusedApp`, `mResumedActivity` lines      | python-androidtv `tests/test_constants.py` (`test_current_app_extraction_*`), real outputs                                                                                                |
| `topResumedActivity`, `ResumedActivity:` (Android 12+)        | **reconstructed** from the AOSP `ActivityTaskManagerService` dump format: to check with `scripts/probe.mjs --raw`                                                                         |
| `- STREAM_MUSIC:` block (Sony, `hmdi_arc`)                    | python-androidtv `tests/test_androidtv_async.py` (`STREAM_MUSIC_ON`, `_OFF`, `_NO_VOLUME`), real outputs                                                                                  |
| `streamVolume:`, `Muted Internally:` (Android 11+)            | **reconstructed** from AOSP `AudioService` dump: to check                                                                                                                                 |
| `state=PlaybackState {state=2, …}`                            | python-androidtv `MEDIA_SESSION_STATE_OUTPUT` (Fire TV launcher), real output                                                                                                             |
| `package=`, `active=` lines, `state=PLAYING(3)` (Android 13+) | **reconstructed** from AOSP `MediaSessionRecord.dump` and `PlaybackState.toString`: to check                                                                                              |
| `mWakefulness=`, `Display Power: state=`                      | the strings python-androidtv greps for (`CMD_SCREEN_ON`, `CMD_AWAKE`); the surrounding lines are reconstructed                                                                            |
| `cmd package query-activities --components`                   | **reconstructed** (one `package/activity` per line): to check; the Sony profile simulates a device without it                                                                             |
| `monkey` and `am start` answers                               | the strings python-androidtv and Home Assistant users report (`Events injected: 1`, `No activities found to run`, `Error: Activity not started, unable to resolve Intent`)                |

The first real test (an NVIDIA SHIELD, after the PR) should replace the reconstructed parts: run
`node scripts/probe.mjs <ip> --raw`, anonymize the serial number and the MAC addresses, and add the outputs here.

python-androidtv is © Jeff Irion, MIT licence; only output samples and patterns are reused.
