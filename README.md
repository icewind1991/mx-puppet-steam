# mx-puppet-steam

Matrix <-> Steam puppeting bridge based on [mx-puppet-bridge](https://github.com/Sorunome/mx-puppet-bridge).

This bridge uses puppeting to bridge your steam messages into a matrix server, this means that the bridge logs into your steam
account using the same api as the regular steam account and forwards any incoming steam message to a matrix chatroom and any
message you send in the matrix chatroom back to steam.

## Status

- [x] login with steam guard support
- [x] 1<->1 messaging
- [x] group messaging
- [x] steam <-> matrix typing notifications
- [x] online/offline status
- [x] retrieve nickname and avatar from steam
- [x] listing of steam users
- [ ] listing of steam group chats
- [ ] listing of members within group chat
- [x] bridging embedded images in 1<->1 chats
- [x] receiving embedded images from steam in group chats
- [ ] sending embedded images to steam in group chats
- [x] steam -> matrix emotes 

## Setup

You need at least node 12 to be able to run this!

Clone the repo and install the dependencies:

```
git clone https://github.com/icewind1991/mx-puppet-steam
cd mx-puppet-steam
npm install
```

Copy and edit the configuration file to your liking:

```
cp sample.config.yaml config.yaml
... edit config.yaml ...
```

Generate an appservice registration file. Optional parameters are shown in
brackets with default values:

```
npm run start -- -r [-c config.yaml] [-f steam-registration.yaml]
```

Then add the path to the registration file to your synapse `homeserver.yaml`
under `app_service_config_files`, and restart synapse.

Finally, run the bridge:

```
npm run start
```

### Docker

If you prefer to use a docker based setup an image is available at [icewind1991/mx-puppet-steam](https://hub.docker.com/r/icewind1991/mx-puppet-steam) (Note that I do longer use the docker image myself so it's mostly untested).

## Linking

Start a chat with @_steampuppet_bot:yourserver.com

```
link <username> <password>
```

If a steam guard (mobile or email) code is required, you will be asked for the code.

## Ephemeral events

To enable bridging ephemeral events from matrix to steam (typing notification, read markers and presence)
you'll need to enable the experimental support in synapse for pushing these events to the bridge by setting

```yaml
"de.sorunome.msc2409.push_ephemeral": true
```

in your registration file.

## Credits

This project would not be possible without the great work of (among others) the following projects:

- [mx-puppet-bridge](https://github.com/Sorunome/mx-puppet-bridge) by Sorunome
- [node-steam-user](https://github.com/DoctorMcKay/node-steam-user/) by DoctorMcKay 
