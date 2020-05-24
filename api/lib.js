"use strict"
const expressSession = require('express-session')
const subgenre = require('subgenre.js')
const axios = require('axios')
const passport = require('passport')
var _ = require('lodash');

const checkAuth = (BASEURL) => {
  return (req, res, next) => {
  if (req.isAuthenticated()) {
    console.log('Request is authenticated.')
    next();
  } else {
    if (req.originalUrl.slice(0,4) == '/api') {
      res.status(400).send({message: 'not authenticated'})
    }
    res.redirect('/api/auth')
    //res.send({message: 'Not authenticated'})
  }
  }
}
const session = expressSession({
  secret: 'cool spotify',
  resave: true,
  saveUninitialized: true,
})

const CONNECTION_TYPES = Object.freeze({
  USER_TO_GENRE: 50,
  GENRE_TO_ARTIST: 30,
  ARTIST_TO_ALBUM: 50,
  ALBUM_TO_SONG: 20,
})

const NODE_TYPES = Object.freeze({
  USER: 1,
  GENRE: 2,
  ARTIST: 3,
  ALBUM: 4,
  SONG: 5
})
const flattenSongArtists = (songs) => {
  let artists = songs.flatMap(song => song.track.artists).map(a => a.id)
  return artists.filter((artist, index, arr) => artists.indexOf(artist) === index && artist != null)
}
const addSongs = (token, uris, playlistId) => {
  let chunks = _.chunk(uris, 100)
  return new Promise((resolve, reject) => {
    let completedCount = 0
    let chunks = _.chunk(uris, 100)
    for (let chunk of chunks) {
      console.log('ATTEMPTING CHUNKY')
      axios.post(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
      {uris: chunk},
      {headers: {
          'Authorization': `Bearer ${token}`
        }
      }).then(resp => {
        completedCount += chunk.length
        if (completedCount >= uris.length) {
          resolve()
        }
        console.log(`Successfully added ${completedCount} songs to playlist id ${playlistId}`)
      }).catch(err => {
        console.log('There was an error:/', err)
        reject(err)
      })
    }

  })
}

const addGenre = (artists) => {
  console.log(`adding genres for artists.`)
  let artistsWithGenres = artists
    .map(a => {
      a.tlgs = a.genres.map(g => subgenre.topLevelGenre(g))
      return a
    })
    .map(a => {
      a.genre = (a.tlgs.length == 0) ? 'other' : subgenre.mostPopularGenre(a.tlgs)
      return a
    })
  console.log('Success')
  let genres = artistsWithGenres.map(a => a.genre)
  let uniq = [...new Set(genres)].reduce((dict, g) => {
    dict[g] = genres.filter(v => v == g).length
    return dict
  }, {})
  uniq.other = 999 // Make sure the 'other genre' does not disappear either
  artistsWithGenres.map(a => {
    if (uniq[a.genre] < 10) {
      a.genre = 'other'
    }
    return a
  })
  return {
    artistsWithGenres: artistsWithGenres,
    genreMap: uniq
  }
}
const generateNodesAndLinks = (songs, artists) => {
  let {
    artistsWithGenres,
    genreMap
  } = addGenre(artists)
  console.log(artistsWithGenres.length)
  console.log(songs.length)
  let nodes = []
  let links = []
  for (let genre in genreMap) {
    // Create all genre nodes
    if (genreMap[genre] < 10) {
      continue
    }
    console.log(genre)
    nodes.push({
      name: genre,
      type: NODE_TYPES.GENRE,
      id: genre,
      link: null
    })
    links.push({
      source: 'USER_NODE',
      target: genre,
      type: CONNECTION_TYPES.USER_TO_GENRE
    })
  }
  console.log('genres  done')
  for (let artist of artistsWithGenres) {
    nodes.push({
      name: artist.name,
      id: artist.id,
      type: NODE_TYPES.ARTIST,
      link: artist.link
    })
    links.push({
      source: artist.id,
      target: artist.genre,
      type: CONNECTION_TYPES.GENRE_TO_ARTIST
    })
  }

  console.log('artists done')
  let visitedAlbums = []
  for (let song of songs) {
    // Create all nodes
    let songNode = {
      name: song.track.name,
      link: song.track.external_urls.spotify,
      type: NODE_TYPES.SONG,
      id: song.track.id
    }
    let albumNode = {
      name: song.track.album.name,
      link: song.track.album.external_urls.spotify,
      type: NODE_TYPES.ALBUM,
      id: song.track.album.id
    }
    if (visitedAlbums.indexOf(song.track.album.id) === -1) {
      nodes.push(albumNode)
      song.track.artists.slice(0, 1).forEach(artist => {
        links.push({
          source: artist.id,
          target: song.track.album.id,
          type: CONNECTION_TYPES.ARTIST_TO_ALBUM
        })
      })
      visitedAlbums.push(song.track.album.id)
    }
    nodes.push(songNode)
    // removed: Create connection between album and each artist
    // removed: Create connection between all artists and user

    // Create connection between album and song
    links.push({
      source: song.track.album.id,
      target: song.track.id,
      type: CONNECTION_TYPES.ALBUM_TO_SONG
    })

  }
  // Add user node
  let userNode = {
    name: 'User Node',
    link: null,
    type: NODE_TYPES.USER,
    id: 'USER_NODE'
  }
  nodes.push(userNode)
  return {
    links,
    nodes
  }
}
function getTracks(url, auth, currentTracks = []) {
  return axios.get(url, {
    headers: {
      'Authorization': `Bearer ${auth}`
    }
  }).then(res => {
    consola.log(url, "=>", res.data.next)
    if (res.data.items !== undefined) {
      currentTracks = currentTracks.concat(res.data.items)
    }
    if (res.data.next) {
      return getTracks(res.data.next, auth, currentTracks)
    } else {
      console.log(`There are ${currentTracks.length} songs.`)
      return currentTracks
    }
  }).catch(err => {
    console.log(err)
  })
}

function getArtists(token, artistIDs) {
  return new Promise((resolve, reject) => {
    let artists = []
    let chunks = _.chunk(artistIDs, 50)
    for (let chunk of chunks) {
      axios.get("https://api.spotify.com/v1/artists", {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        params: {
          ids: _.join(chunk, ',')
        }
      }).then(resp => {
        console.log(artists.length)
        artists.push(...resp.data.artists)
        if (artistIDs.length == artists.length) {
          resolve(artists)
        }
      }).catch(err => {
        console.log('There was an error:/', err)
        reject(err)
      })
    }

  })
}
function getRelated(token, artistIDs) {
  return new Promise((resolve, reject) => {

    let finished = []
    artistIDs.forEach(id => {
      getRelatedHelper(`https://api.spotify.com/v1/artists/${id}/related-artists`, {
        'Authorization': `Bearer ${token}`
      }).then(response => {
        finished.push(response)
        if (finished.length == artistIDs.length) {
          resolve(finished)
        }
      }).catch(err => {
        reject(err)
      })
    })
  })
}
const waitF = time => new Promise(resolve => setTimeout(resolve, time * 1000))
function getRelatedHelper(url, headers) {
  return new Promise((resolve, reject) => {
  axios.get(url, {headers}).then(res => {
    resolve(res.data)
  }).catch(err => {
        console.log('There was an error')
        if (!err.response || err.response.status == 429) {
          console.log('Retrying...')

          let timeToWait = err.response ? parseInt(err.response.headers['retry-after'], 10) : 5
          console.log('wait for it', timeToWait)
          waitF(timeToWait).then(getRelatedHelper(url, headers))
          .then(d => resolve(d))
          .catch(e => reject(err))
        } else {
          console.log(err)
          reject(err)
        }
  })
  })
}
function getAudioFeatures(token, songIDs) {
  return new Promise((resolve, reject) => {
    console.log('Running...')
    let features = []
    let chunks = _.chunk(songIDs, 100)
    for (let chunk of chunks) {
      axios.get("https://api.spotify.com/v1/audio-features", {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        params: {
          ids: _.join(chunk, ',')
        }
      }).then(resp => {
        console.log(features.length)
        features.push(...resp.data.audio_features)
        if (songIDs.length == features.length) {
          resolve(features)
        }
      }).catch(err => {

        reject(err)
      })
    }

  })
}
module.exports = {
  session,
  checkAuth,
  generateNodesAndLinks,
  flattenSongArtists,
  getTracks,
  getArtists,
  addSongs,
  getRelated,
  getAudioFeatures
}
