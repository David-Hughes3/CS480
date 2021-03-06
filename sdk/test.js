// MongoDB imports
const mongoose = new require('mongoose');
const mongoDbUri = require('./config').mongoDbUri;
const UserModelImported = new require('../backend/users/User');
const GameModelImported = new require('../backend/games/Game');
// the actual models we're using with proper connection to correct mongoDB URI
var UserModel = null;
var GameModel = null;

const assert = require('assert');
const Promise = require('promise');

// sdk imports
const BaseConnection = require('./lib/BaseConnection');
const User = require('./src/User');
const Game = require('./src/Game');

const baseConnection = new BaseConnection('localhost', '3000');
const userJames = new User(baseConnection);
const userJohn = new User(baseConnection);
const user3 = new User(baseConnection);
const game = new Game(baseConnection, require('ws'));
const game2 = new Game(baseConnection, require('ws'));
const game3 = new Game(baseConnection, require('ws'));

const call = require('./shell');
// const GameConfig = require('../backend/games/GameConfiguration');

/**
 * Connect to the proper mongoDB URI
 */
before(function() {
  if (!(mongoDbUri.includes('test') || mongoDbUri.includes('localhost') ||
    mongoDbUri.includes('127.0.0.1')))
    throw new Error(`${mongoDbUri} might not be safe to use for tests`);

  let conn = mongoose.createConnection(mongoDbUri);
  UserModel = conn.model('User', UserModelImported.schema);
  GameModel = conn.model('Game', GameModelImported.schema);
});


/**
 * Remove all data from db.users and db.games
 */
before(function() {
  UserModel.remove({})
    .catch(err => err);

  GameModel.remove({})
    .catch(err => err);
});

/**
 * TODO: Use User#getUsers to confirm this a 2nd time
 */
describe('list of users', () => {
  it('should be equal to empty array', function(done) {
      this.timeout(4000); // in milliseconds
      UserModel.find()
        .catch(err => err)
        .then((users) => {
          assert(users.length === 0);
        })
        .then(() => done(), done);
    })
});

describe('User#create: create 2 new users', () => {
  it('each should return user doc in the response', async function() {
    // limited time to finish this test before entire test run ends due to timeout
    this.timeout(4000); // in milliseconds

    // user
    let username = 'james',
        password = 'pw';

    let email = 'john@email.com'; // user2 email

    // need to wait for this since we rely on using this users info for
    // next test function calls
    let p1 = userJames.create(username, password)
      .then((response) => {
        assert(username === response.username);
        assert(username === userJames.username);
      })
      .catch(err => err);

    let p2 = userJohn.create('john', 'pw', email)
      .then(response => {
        assert(response.email === email);
        assert(userJohn.email === email);
      })
      .catch(err => err);

    await Promise.all([p1, p2]);
  });
});

describe('User#login: have james login successfully', () => {
  it('should return the user doc associated with james', function() {
    return (new User(baseConnection)).login(userJames.username, 'pw')
      .then(json => {
        assert(json._id === userJames.id);
      })
  });
});

describe('db.users', () => {
  it('should contain two users', function(done) {
    // limit it to 2 seconds to finish this test
    this.timeout(2000);
    UserModel.find({}, (err, users) => {
      if (err) return done(err);
      assert(users.length === 2);
      done();
    });
  });
});

describe('User#create: try to create a user with a taken username', () => {
  it('should throw an exception in the http response', function(done) {
    // limit it to 2 seconds to finish this test
    this.timeout(2000);

    let username = 'james',
        password = 'pw';

    // need to wait for this since we rely on using this users info for
    // next test function calls
    user3.create(username, password)
      .then((response) => {
        assert(username === response.username);
        assert(username === userJames.username);
        done();
      })
      // TODO: use expect function from chai to assert exception is thrown
      .catch(err => done())
      // .catch(err => done(new Error(err.message)));
  });
});

/**
 * Create a new game
 * example of response output from call to Game#create
 *
 * { users: [ '5ad3ee2a2f3ed1439ba7b802' ],
 * geolocations: { '5ad3ee2a2f3ed1439ba7b802': { lat: 123, lon: 123 } },
 * _id: '5ad3ee2b2f3ed1439ba7b803',
 * name: 'room1',
 * __v: 0 }
 */
describe('Game#create: create a new game', () => {
  it('should return the game doc in the response', async () => {
    let name = 'room1',
        userId = userJames.id,
        lat = 123,
        lon = 123;
    await game.create(name, userId, lat, lon)
      .then(response => {
        assert(response.users && response.users[0], 'something is in game.users');
        assert(response.geolocations[userId], `${userJames.id} is in game.geolocations`);
      })
      .catch(err => err);
  });
});

describe('Game#listenForRegionChange: adds a callback to call when region info changed', () => {
  it('should call the callback before all the test cases finish', () => {
    let callback = (json) => {
      // console.log('callback for regionChange', json);
      let regions = json.regions;
      regions.forEach((regionInfo) => {
        assert(regionInfo.hasOwnProperty('lat'));
        assert(regionInfo.hasOwnProperty('lon'));
        assert(regionInfo.hasOwnProperty('owner'));
        assert(regionInfo.hasOwnProperty('type'));
        assert(regionInfo.hasOwnProperty('radius'));
      });

      if (json.troops) {
        assert(userJames.id in json.troops);
      }
    };

    return game.listenForRegionChange(callback);
  });
});

describe('Game#setGeolocation: set james\'s geolocation to 10, 50 (lon, lat)', () => {
  it('should change the info stored in the game doc', function(done) {
    game.setGeolocation(userJames.id, 10, 50)
      .then(json => {
        assert(json.geolocations[userJames.id].lon === 10);
        assert(json.geolocations[userJames.id].lat === 50);
        done();
      })
      .catch(err => done(new Error(err.message || err.data)));
  })
});

describe('Game#join: have john join the game james is in', () => {
  it('should put john in the game', async () => {
    await game.join(userJohn.id, null, userJames.username)
      .then(json => {
        assert(json.users.length === 2, 'users contains two users');
        assert(Object.keys(json.geolocations).length === 2);
      })
      .catch(err => {throw new Error(err['message'] || err.data)})
  })
});

describe('john moves directly on top of a capture region', () => {
  it('should change that region owner to john\'s id', () => {
    let lat = game.regions[0].lat;
    let lon = game.regions[0].lon;

    game.listenForRegionChange((data) => {
      console.log('john mv', data);
      assert(data.regions[0].owner === userJohn.id);
      // game.listenForRegionChange(() => {});
    });

    return game.setGeolocation(userJohn.id, lon, lat)
      .then(async (json) => {
        console.log(json);
        await wait(2); // give time for doc to update then check
        // return game.getGeolocation()
        //   .then(json => {
        //     console.log(json);
        //     assert(json.regions[0].owner === userJohn.id, 'john is owner');
        //   })
        //   .catch(err => err)
      })
      .catch(err => {
        throw new Error(err.message || err.data);
      });
  });
});

describe('wait 5.1 seconds and check john\'s score', () => {
  it('should indicate that john has a score of 1', async function() {
    this.timeout(6000);
    await wait(5.1);
    return game.getGame()
      .then(json => {
        assert(json.scores[userJohn.id] === 1);
      })
      .catch(err => {
        throw new Error(err.message);
      })
  });
});

describe('check the troops in the region john captured', () => {
  it('should be 2 (1 init, + 1 after 1 game loop on server', () => {
    return game.getGame()
      .then(json => {
        assert(json.regions[0].troops === 2);
      })
      .catch(err => err)
  });
});

describe('transfer 2 troops from john to his base he captured', () => {
  it('should decrement john\'s troops by 2 and increase his base\'s troops by 2', () => {
    return game.transferTroopsToBase(userJohn.id, 0, 2)
      .then(json => {
        // console.log(json);
        assert(json.regions[0].troops === 4);
        assert(json.troops[userId] === 3);
      })
      .catch(err => err)
  })
});

describe('transfer 4 troops from john\'s base to john', () => {
  it('should decrease the troops in his base by 4 and increase his troops by 4', () => {
    return game.transferTroopsToBase(userJohn.id, 0, -4)
      .then(json => {
        // console.log(json);
        assert(json.regions[0].troops === 0);
        assert(json.troops[userId] === 7);
      })
      .catch(err => err)
  });
});

describe('transfer 900 troops to john\'s from his base', () => {
  it('should decrease the troops in his base by all available and increase his ' +
    'troops by same amount', () => {

    return game.transferTroopsToBase(userJohn.id, 0, 900)
      .then(json => {
        // console.log(json);
        assert(json.regions[0].troops === 7);
        assert(json.troops[userId] === 0);
      })
      .catch(err => err)
  });
});

describe('Game#leave: have each user leave the game', () => {
  it('should remove james & john from the game then delete the empty game', () => {
    return game.leave(userJames.id)
      .then(json => {
        assert(json.users.length === 1);
        game.leave(userJohn.id)
          .then(json => {
            assert(json.users.length === 0);
          })
          .catch(err => {
            throw new Error(err.message);
          })
      })
      .catch(err => {
        throw new Error(err.message);
      })
  });
});

describe('check the number of troops in the region john captured', () => {
  it('should be 5 (1 for init capture, 4 for 4 game loops that occurred', () => {
    return game2.getGame()
      .then(json => {
        assert(json.regions[0].troops === 5);
      })
      .catch(err => err)
  });
});

describe('add john to the 3rd game, ' +
  'move him to capture zone, wait for him to be awarded points', () => {
  it('should end the game as john acquired enough points to win', async function() {
    this.timeout(8000);

    return game3.create('game3', userJohn.id, 1, 1,)
      .then(json => {
        let lat = json.regions[0].lat;
        let lon = json.regions[0].lon;

        return game3.setGeolocation(userJohn.id, lon, lat)
          .then(async (json) => {
            await wait(6);

            return game3.getGame()
              .then(json => {
                console.log(json);
                assert(json.winner === userJohn.id, 'john is the winner');
              })
              .catch(err => err)
          })
          .catch(err => err)
      })
    .catch(err => err)
  });
});

describe('add john to the 2nd game, ' +
  'move him to capture zone', () => {
  it('should end the game as time runs out with john declared as winner', async function() {
    this.timeout(23000);  // 23 seconds

    return game2.create('game2', userJohn.id, 1, 1,)
      .then(json => {
        let lat = json.regions[0].lat;
        let lon = json.regions[0].lon;

        // move john to the capture region
        return game2.setGeolocation(userJohn.id, lon, lat)
          .then(async (json) => {
            await wait(6);

            // move john out of the capture region
            return game2.setGeolocation(userJohn.id, lon, lat)
              .then(async (json) => {
                await wait(15);

                return game2.getGame()
                  .then(json => {
                    console.log(json);
                    assert(json.winner === userJohn.id, 'john is the winner');
                  })
                  .catch(err => err)
              })
              .catch(err => err);
          })
          .catch(err => err)
      })
    .catch(err => err)
  });
});

// region: helper functions //

function wait(time) {
  return new Promise(resolve => {
    setTimeout(
      () => resolve(),
      time * 1000,
    );
  })
}

// endregion: helper functions //