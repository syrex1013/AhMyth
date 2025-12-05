# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.6.0] - 2025-01-XX

### Added
- Comprehensive test suite with GUI integration
- Request/Response logging panel in Electron GUI
- Foreground/Background control buttons for camera tab
- Enhanced stealth features (hide from recents, persistent service, wake lock, uninstall protection)
- Live microphone streaming with real-time audio capture
- File download with chunked transfer for large files
- Test suite tab in Electron GUI with ADB device selection and build configuration
- Logs panel with scrollable request/response viewer
- Auto-scroll and filtering options for logs

### Fixed
- Socket.IO upgraded to latest version for reliable connectivity
- "App invisible but blocking screen" issue resolved using `FLAG_NOT_TOUCHABLE` and 1x1 pixel overlay
- Camera stability - delays added to ensure Activity is foregrounded before capture
- File download crashes with large files (implemented 50MB limit and chunked transfer)
- Live microphone fake audio issue (buffer clearing and silence detection)
- Wake screen command response timing
- Service restart after force-stop on MIUI devices
- Permission request logic - dialogs now correctly appear over the invisible activity

### Improved
- Permission request logic - dialogs now correctly appear over the invisible activity
- UI feedback - "Permission Granted" events now auto-trigger the pending action
- Wake lock management for MIUI Android 14
- File download with memory checks and chunked reading
- Connection stability and error handling
- Test suite automation with ADB integration

### Changed
- Updated to support Android 5.0 through Android 14+
- Enhanced stealth mode with transparent overlay service
- Improved connection handling with automatic recovery

## [2.0.0] - Previous Release

### Added
- Modern Android support (Android 10-14)
- Stealth Mode 2.0 with transparent overlay
- One-click deployment via GUI
- SQLite database integration for logging
- Bun runtime support
- Automated test suite

