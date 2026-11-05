export function ranking(room) { return Object.values(room.players).sort((a, b) => b.score - a.score || b.correct - a.correct || a.joinedAt - b.joinedAt || a.nickname.localeCompare(b.nickname)); }
