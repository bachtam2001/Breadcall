# Room ID Format Change Design

**Date:** 2026-03-28
**Topic:** Change room ID format from 4-character to 3-4-3 hyphenated word format

## Overview

Change room ID format from 4-character uppercase (e.g., `N9CR`) to 3-4-3 lowercase hyphenated format (e.g., `abc-defg-hij`).

## Specification

### Format
- **Pattern:** `xxx-xxxx-xxx` (3 letters - 4 letters - 3 letters)
- **Character set:** lowercase a-z (26 characters)
- **Total entropy:** 26^10 ≈ 141 trillion combinations
- **Length:** 12 characters (including hyphens)
- **Validation regex:** `/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/`

### Examples
- `sun-blue-tree`
- `xyz-abcd-efg`
- `the-quick-brow`
- `joy-fast-calm`

## Components to Modify

### 1. server/src/RoomManager.js
**Function:** `generateRoomId()`
- Change from 4-char uppercase generation
- Generate 3 random lowercase letters
- Add hyphen
- Generate 4 random lowercase letters
- Add hyphen
- Generate 3 random lowercase letters
- Keep collision detection loop

### 2. server/src/SignalingHandler.js
**Function:** `isValidRoomId()`
- Update regex from `/^[A-Z0-9]{4}$/` to `/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/`

### 3. client/js/UIManager.js
**Changes:**
- Update input validation for new format
- Add auto-formatting (insert hyphens as user types)
- Update input placeholder text
- Update error messages

### 4. Tests
**Files to update:**
- `server/__tests__/RoomManager.test.js`
- `server/__tests__/SignalingHandler.test.js`
- Any other tests with hardcoded 4-char room IDs

## Backward Compatibility

**No backward compatibility required.**
- Old 4-character room IDs will not be recognized
- Existing rooms in database will become invalid
- Clean break to new format only

## Implementation Checklist

- [ ] Update `generateRoomId()` in RoomManager.js
- [ ] Update `isValidRoomId()` in SignalingHandler.js
- [ ] Update validation in UIManager.js
- [ ] Update client-side input handling
- [ ] Update all test files
- [ ] Test room creation with new format
- [ ] Test room joining with new format
- [ ] Test validation edge cases

## Migration Notes

Since backward compatibility is not required:
- No database migration needed
- No dual-format support needed
- Simple find-and-replace in tests
- All existing room data can be purged
