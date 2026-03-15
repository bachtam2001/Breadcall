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

        // RBAC/OLA Tables
        this.db.run(`
          CREATE TABLE IF NOT EXISTS roles (
            name VARCHAR(50) PRIMARY KEY,
            hierarchy INTEGER NOT NULL UNIQUE,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err2) => {
          if (err2) {
            reject(err2);
            return;
          }

          this.db.run(`
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              username VARCHAR(255) UNIQUE NOT NULL,
              password_hash VARCHAR(255) NOT NULL,
              role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE RESTRICT,
              email VARCHAR(255),
              display_name VARCHAR(255),
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `, (err3) => {
            if (err3) {
              reject(err3);
              return;
            }

            this.db.run(`
              CREATE TABLE IF NOT EXISTS role_permissions (
                role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
                permission VARCHAR(100) NOT NULL,
                object_type VARCHAR(50) NOT NULL,
                PRIMARY KEY (role, permission, object_type)
              )
            `, (err4) => {
              if (err4) {
                reject(err4);
                return;
              }

              this.db.run(`
                CREATE TABLE IF NOT EXISTS room_assignments (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  room_id VARCHAR(10) NOT NULL,
                  assignment_role VARCHAR(50) NOT NULL,
                  granted_by TEXT REFERENCES users(id),
                  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  expires_at DATETIME,
                  UNIQUE(user_id, room_id)
                )
              `, (err5) => {
                if (err5) {
                  reject(err5);
                  return;
                }

                this.db.run(`
                  CREATE TABLE IF NOT EXISTS stream_access (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    stream_id VARCHAR(255) NOT NULL,
                    granted_by TEXT REFERENCES users(id),
                    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    expires_at DATETIME,
                    UNIQUE(user_id, stream_id)
                  )
                `, (err6) => {
                  if (err6) {
                    reject(err6);
                    return;
                  }

                  // Create indexes
                  this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`, (err7) => {
                    if (err7) {
                      reject(err7);
                      return;
                    }
                    this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`, (err8) => {
                      if (err8) {
                        reject(err8);
                        return;
                      }
                      this.db.run(`CREATE INDEX IF NOT EXISTS idx_room_assignments_user ON room_assignments(user_id)`, (err9) => {
                        if (err9) {
                          reject(err9);
                          return;
                        }
                        this.db.run(`CREATE INDEX IF NOT EXISTS idx_room_assignments_room ON room_assignments(room_id)`, (err10) => {
                          if (err10) {
                            reject(err10);
                            return;
                          }
                          this.db.run(`CREATE INDEX IF NOT EXISTS idx_stream_access_user ON stream_access(user_id)`, (err11) => {
                            if (err11) {
                              reject(err11);
                              return;
                            }
                            this.db.run(`CREATE INDEX IF NOT EXISTS idx_stream_access_stream ON stream_access(stream_id)`, (err12) => {
                              if (err12) {
                                reject(err12);
                                return;
                              }
                              console.log('[Database] RBAC/OLA tables and indexes created');
                              resolve();
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
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

  // RBAC/OLA User CRUD methods

  async insertUser(user) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO users
         (id, username, password_hash, role, email, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          user.username,
          user.password_hash,
          user.role,
          user.email || null,
          user.display_name || null,
          user.created_at || new Date().toISOString(),
          user.updated_at || new Date().toISOString()
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

  async getUserById(id) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE id = ?',
        [id],
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

  async getUserByUsername(username) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE username = ?',
        [username],
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

  async getAllUsers() {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT id, username, role, email, display_name, created_at, updated_at FROM users ORDER BY created_at DESC',
        [],
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

  async updateUserRole(userId, newRole) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newRole, userId],
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

  async deleteUser(userId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM users WHERE id = ?',
        [userId],
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

  async getRole(name) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM roles WHERE name = ?',
        [name],
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

  async getAllRoles() {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM roles ORDER BY hierarchy DESC',
        [],
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

  async getPermissionsForRole(role) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM role_permissions WHERE role = ?',
        [role],
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

  async insertRoomAssignment(assignment) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO room_assignments
         (id, user_id, room_id, assignment_role, granted_by, granted_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          assignment.id,
          assignment.user_id,
          assignment.room_id,
          assignment.assignment_role,
          assignment.granted_by,
          assignment.granted_at || new Date().toISOString(),
          assignment.expires_at || null
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

  async getRoomAssignmentsForUser(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM room_assignments WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)',
        [userId, new Date().toISOString()],
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

  async getRoomAssignments(roomId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT ra.*, u.username FROM room_assignments ra JOIN users u ON ra.user_id = u.id WHERE ra.room_id = ?',
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

  async removeRoomAssignment(userId, roomId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM room_assignments WHERE user_id = ? AND room_id = ?',
        [userId, roomId],
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

  async grantStreamAccess(access) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO stream_access
         (id, user_id, stream_id, granted_by, granted_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          access.id,
          access.user_id,
          access.stream_id,
          access.granted_by,
          access.granted_at || new Date().toISOString(),
          access.expires_at || null
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

  async getStreamAccessForUser(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM stream_access WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)',
        [userId, new Date().toISOString()],
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

  async getStreamAccess(streamId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT sa.*, u.username FROM stream_access sa JOIN users u ON sa.user_id = u.id WHERE sa.stream_id = ?',
        [streamId],
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

  async revokeStreamAccess(userId, streamId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM stream_access WHERE user_id = ? AND stream_id = ?',
        [userId, streamId],
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

  async loadSeedData(seedFilePath) {
    return new Promise((resolve, reject) => {
      fs.readFile(seedFilePath, 'utf8', (err, sql) => {
        if (err) {
          reject(err);
          return;
        }
        this.db.exec(sql, (err2) => {
          if (err2) {
            reject(err2);
            return;
          }
          console.log('[Database] Seed data loaded from', seedFilePath);
          resolve();
        });
      });
    });
  }
}

module.exports = Database;
