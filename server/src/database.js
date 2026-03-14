const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'breadcall.db');
    this.db = null;
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      // Ensure data directory exists
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }
        console.log('[Database] Connected to SQLite');
        this._createTables().then(resolve).catch(reject);
      });
    });
  }

  async _createTables() {
    return new Promise((resolve, reject) => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          tokenId TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          roomId TEXT NOT NULL,
          userId TEXT NOT NULL,
          expiresAt INTEGER NOT NULL,
          createdAt INTEGER NOT NULL,
          revokedAt INTEGER,
          revokedReason TEXT,
          rotatedTo TEXT,
          rotatedFrom TEXT,
          FOREIGN KEY (rotatedTo) REFERENCES refresh_tokens(tokenId),
          FOREIGN KEY (rotatedFrom) REFERENCES refresh_tokens(tokenId)
        )
      `, (err) => {
        if (err) {
          reject(err);
          return;
        }
        console.log('[Database] Tables created');
        resolve();
      });
    });
  }

  async getAllTables() {
    return new Promise((resolve, reject) => {
      this.db.all(
        "SELECT name FROM sqlite_master WHERE type='table'",
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows.map(row => row.name));
        }
      );
    });
  }

  async insertRefreshToken(tokenData) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO refresh_tokens
         (tokenId, type, roomId, userId, expiresAt, createdAt, revokedAt, revokedReason, rotatedTo, rotatedFrom)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tokenData.tokenId,
          tokenData.type,
          tokenData.roomId,
          tokenData.userId,
          tokenData.expiresAt,
          tokenData.createdAt || Date.now(),
          tokenData.revokedAt || null,
          tokenData.revokedReason || null,
          tokenData.rotatedTo || null,
          tokenData.rotatedFrom || null
        ],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  async getRefreshToken(tokenId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM refresh_tokens WHERE tokenId = ?',
        [tokenId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row || null);
        }
      );
    });
  }

  async revokeRefreshToken(tokenId, reason = 'revoked') {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE refresh_tokens SET revokedAt = ?, revokedReason = ? WHERE tokenId = ?',
        [Date.now(), reason, tokenId],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  async rotateRefreshToken(oldTokenId, newTokenId) {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // Mark old token as rotated
        this.db.run(
          'UPDATE refresh_tokens SET rotatedTo = ? WHERE tokenId = ?',
          [newTokenId, oldTokenId],
          (err) => {
            if (err) {
              reject(err);
              return;
            }
            // Create new token entry with rotatedFrom reference
            this.db.run(
              'INSERT OR IGNORE INTO refresh_tokens (tokenId, rotatedFrom) VALUES (?, ?)',
              [newTokenId, oldTokenId],
              (err2) => {
                if (err2) {
                  reject(err2);
                  return;
                }
                resolve();
              }
            );
          }
        );
      });
    });
  }

  async getTokensByRoom(roomId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM refresh_tokens WHERE roomId = ? AND revokedAt IS NULL AND rotatedTo IS NULL',
        [roomId],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows);
        }
      );
    });
  }

  async revokeTokensByRoom(roomId, reason = 'room deleted') {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE refresh_tokens SET revokedAt = ?, revokedReason = ? WHERE roomId = ?',
        [Date.now(), reason, roomId],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve(this.changes);
        }
      );
    });
  }

  async cleanupExpiredTokens() {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM refresh_tokens WHERE expiresAt < ?',
        [Date.now()],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve(this.changes);
        }
      );
    });
  }

  async close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        console.log('[Database] Closed connection');
        resolve();
      });
    });
  }
}

module.exports = Database;
