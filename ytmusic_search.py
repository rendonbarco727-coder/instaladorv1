#!/usr/bin/env python3
import sys
import json
from ytmusicapi import YTMusic

ytm = YTMusic()

def search(query, limit=20):
    try:
        results = ytm.search(query, limit=limit)
        songs = []
        for r in results:
            if r.get('resultType') not in ('song', 'video'):
                continue
            vid = r.get('videoId')
            if not vid:
                continue
            thumb = ''
            thumbs = r.get('thumbnails', [])
            if thumbs:
                thumb = thumbs[-1].get('url', '')
            duration = r.get('duration_seconds') or 0
            artists = r.get('artists') or []
            artist = artists[0].get('name', '—') if artists else '—'
            songs.append({
                'videoId': vid,
                'titulo': r.get('title', 'Sin título'),
                'artista': artist,
                'thumbnail': thumb,
                'duracion': duration,
                'url': f'https://www.youtube.com/watch?v={vid}'
            })
        print(json.dumps(songs))
    except Exception as e:
        print(json.dumps({'error': str(e)}))

if __name__ == '__main__':
    q = ' '.join(sys.argv[1:])
    search(q)
