import {
	IFileEvent,
	IMessageEvent,
	IReceiveParams,
	IRemoteRoom,
	IRemoteUser,
	Log,
	PuppetBridge,
} from "mx-puppet-bridge";
import * as SteamUser from "steam-user";
import * as SteamID from "steamid";
import {EPersonaState} from "./enum";
import {MatrixPresence} from "mx-puppet-bridge/lib/src/presencehandler";
import {AppInfo, IIncomingFriendMessage, IPersona} from "./interfaces";
import {IRetList} from "mx-puppet-bridge/src/interfaces";

const log = new Log("MatrixPuppet:Steam");

interface ISteamPuppet {
	client: SteamUser;
	data: any;
	sentEventIds: string[];
	knownPersonas: Map<string, IPersona>,
	knownApps: Map<string, AppInfo>,
}

interface ISteamPuppets {
	[puppetId: number]: ISteamPuppet;
}

interface IPuppetParams {
	accountName: string,
	loginKey: string,

	[key: string]: string;
}

export class Steam {
	private puppets: ISteamPuppets = {};

	constructor(
		private bridge: PuppetBridge,
	) {

	}

	async getPersona(p: ISteamPuppet, steamid: SteamID): Promise<IPersona> {
		let steamIdString = steamid.toString();
		let persona = p.knownPersonas.get(steamIdString);
		if (persona) {
			return persona;
		} else if (p.client.users[steamIdString]) {
			return p.client.users[steamIdString];
		} else {
			let {personas} = await p.client.getPersonas([steamid]);
			let persona = personas[steamIdString];
			p.knownPersonas.set(steamIdString, persona);
			return persona;
		}
	}

	async getProduct(p: ISteamPuppet, appId: string): Promise<AppInfo> {
		let app = p.knownApps.get(appId);
		if (app) {
			return app;
		} else {
			let {apps} = await p.client.getProductInfo([parseInt(appId, 10)], []);
			let app = apps[appId];
			p.knownApps.set(appId, app);
			return app;
		}
	}

	public async getSendParams(puppetId: number, msg: IIncomingFriendMessage, fromSteamId?: SteamID): Promise<IReceiveParams> {
		const p = this.puppets[puppetId];

		let persona = await this.getPersona(p, fromSteamId ? fromSteamId : msg.steamid_friend);

		return {
			room: {
				puppetId,
				roomId: msg.steamid_friend.toString(),
				isDirect: true,
			},
			user: {
				puppetId,
				userId: fromSteamId ? fromSteamId.toString() : msg.steamid_friend.toString(),
				name: persona.player_name,
				avatarUrl: persona.avatar_url_medium
			},
			eventId: `${msg.server_timestamp.toISOString()}::${msg.ordinal}`,
		} as IReceiveParams;
	}

	public async newPuppet(puppetId: number, data: IPuppetParams) {
		log.info(`Adding new Puppet: puppetId=${puppetId}`);
		if (this.puppets[puppetId]) {
			await this.deletePuppet(puppetId);
		}
		const client = new SteamUser();

		this.puppets[puppetId] = {
			client,
			data,
			sentEventIds: [],
			typingUsers: {},
			knownPersonas: new Map(),
			knownApps: new Map(),
		} as ISteamPuppet;
		try {
			client.logOn({
				accountName: data.accountName,
				loginKey: data.loginKey,
				rememberPassword: true,
			});

			client.on("user", async (steamId, persona: IPersona) => {
				const p = this.puppets[puppetId];
				p.knownPersonas.set(steamId.toString(), persona);

				let state: MatrixPresence = "offline";

				switch (persona.persona_state) {
					case EPersonaState.Away:
					case EPersonaState.Busy:
					case EPersonaState.Snooze:
						state = "unavailable";
						break;
					case EPersonaState.LookingToPlay:
					case EPersonaState.LookingToTrade:
					case EPersonaState.Online:
						state = "online";
						break;
				}

				if (steamId.toString() != client.steamID.toString()) {

					await this.bridge.setUserPresence({
						puppetId,
						userId: steamId.toString()
					}, state);

					if (persona.gameid && persona.gameid !== '0') {
						let app = await this.getProduct(p, persona.gameid);
						await this.bridge.setUserStatus({
							puppetId,
							userId: steamId.toString()
						}, `Now playing: ${app.appinfo.common.name}`);
					} else {
						await this.bridge.setUserStatus({
							puppetId,
							userId: steamId.toString()
						}, "");
					}
				}
			});

			client.on("loggedOn", async (details) => {
				await this.bridge.setUserId(puppetId, client.steamID.toString());

				await this.bridge.sendStatusMessage(puppetId, `connected as ${details.vanity_url}(${client.steamID.toString()})!`);

				client.setPersona(EPersonaState.Away);
			});

			client.on("loginKey", (loginKey) => {
				log.info("got new login key");
				data.loginKey = loginKey;
				this.bridge.setPuppetData(puppetId, data);
			});

			client.chat.on("friendMessage", (message) => {
				this.handleFriendMessage(puppetId, message);
			});
			client.chat.on("friendMessageEcho", (message) => {
				this.handleFriendMessage(puppetId, message, client.steamID);
			});
			client.chat.on("friendTyping", (message: IIncomingFriendMessage) => {
				this.handleFriendTyping(puppetId, message);
			});

			client.on("error", (err) => {
				log.error(`Failed to start up puppet ${puppetId}`, err);
				this.bridge.sendStatusMessage(puppetId, `**disconnected!**: failed to connect. ${err}`);
			});
		} catch (err) {
			log.error(`Failed to start up puppet ${puppetId}`, err);
			await this.bridge.sendStatusMessage(puppetId, `**disconnected!**: failed to connect. ${err}`);
		}
	}

	public async deletePuppet(puppetId: number) {
		log.info(`Got signal to quit Puppet: puppetId=${puppetId}`);
		const p = this.puppets[puppetId];
		if (!p) {
			return; // nothing to do
		}

		p.client.logOff();

		delete this.bridge[puppetId];
	}

	public async handleFriendMessage(puppetId: number, message: IIncomingFriendMessage, fromSteamId?: SteamID) {
		const p = this.puppets[puppetId];
		log.verbose("Got message from steam to pass on");

		let sendParams = await this.getSendParams(puppetId, message, fromSteamId);

		// message is only an embedded image
		if (
			message.message_bbcode_parsed.length === 1
			&& message.message_bbcode_parsed[0].tag === 'img'
			&& message.message_no_bbcode === message.message_bbcode_parsed[0].attrs['src']
		) {
			await this.bridge.sendImage(sendParams, message.message_bbcode_parsed[0].attrs['src']);
		} else {
			await this.bridge.sendMessage(sendParams, {
				body: message.message_no_bbcode,
			});
		}
	}

	public async handleFriendTyping(puppetId: number, message: IIncomingFriendMessage) {
		await this.bridge.setUserTyping({
			room: {
				puppetId,
				roomId: message.steamid_friend.toString(),
			},
			user: {
				puppetId,
				userId: message.steamid_friend.toString(),
			},
		}, true);
	}

	public async sendMessageToSteam(
		p: ISteamPuppet,
		room: IRemoteRoom,
		eventId: string,
		msg: string,
		mediaId?: string,
	) {
		try {
			let _roomSteamId = new SteamID(room.roomId as string);
			if (_roomSteamId.isValid()) {
				const sendMessage = await p.client.chat.sendFriendMessage(room.roomId, msg);
				let id = `${sendMessage.server_timestamp.toISOString()}::${sendMessage.ordinal}`;

				await this.bridge.eventSync.insert(room, eventId, id);
				p.sentEventIds.push(id);
			} else {
				await this.bridge.sendStatusMessage(room.puppetId, `Sending group messages is currently not supported`);
			}
		} catch (e) {
			await this.bridge.sendStatusMessage(room.puppetId, `Sending group messages is currently not supported`);
		}
	}

	public async handleMatrixMessage(room: IRemoteRoom, data: IMessageEvent, event: any) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		log.verbose("Got message to send on");
		// room.roomId, data.body
		await this.sendMessageToSteam(p, room, data.eventId!, data.body);
	}

	public async handleMatrixImage(room: IRemoteRoom, data: IFileEvent, event: any) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		log.verbose("Got image to send on");
	}

	public async handleMatrixVideo(room: IRemoteRoom, data: IFileEvent, event: any) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		log.verbose("Got video to send on");
	}

	public async createUser(user: IRemoteUser): Promise<IRemoteUser | null> {
		const p = this.puppets[user.puppetId];
		if (!p) {
			return null;
		}

		let persona = await this.getPersona(p, new SteamID(user.userId));

		log.info(`Got request to create user ${user.userId}`);
		return {
			userId: user.userId,
			puppetId: user.puppetId,
			name: persona.player_name,
			avatarUrl: persona.avatar_url_medium
		};
	}

	public async listUsers(puppetId: number): Promise<IRetList[]> {
		let friends = this.puppets[puppetId].client.users as { [steamId: string]: IPersona };

		return Object.keys(friends).map((steamId) => ({
			id: steamId,
			name: friends[steamId].player_name
		}));
	}

	public async getDmRoomId(user: IRemoteUser): Promise<string | null> {
		log.info(`Got request for dm room id for ${user.userId}`);

		if (!this.puppets[user.puppetId]) {
			return null;
		}

		return user.userId;
	}

	public async createRoom(room: IRemoteRoom): Promise<IRemoteRoom | null> {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return null;
		}

		try {
			let steamId = new SteamID(room.roomId);
			if (!steamId.isValid()) {
				throw new Error();
			}

			let persona = await this.getPersona(p, steamId);

			log.info(`Got request to room user ${room.roomId}`);
			return {
				puppetId: room.puppetId,
				roomId: room.roomId,
				isDirect: true,
				topic: persona.player_name
			};
		} catch (e) {
			await this.bridge.sendStatusMessage(room.puppetId, `Creating group room chats is currently not supported`);
			return null;
		}
	}

	// public async getUserIdsInRoom(room: IRemoteRoom): Promise<Set<string> | null> {
	// 	const p = this.puppets[room.puppetId];
	// 	const client: TalkClient = p.client;
	// 	const participants = await client.getChat(room.roomId).get_participants();
	// 	for (const participant of participants) {
	// 		p.knownUserNames[participant.userId] = participant.displayName;
	// 	}
	// 	return new Set(participants.map((participant) => participant.userId));
	// }
}
