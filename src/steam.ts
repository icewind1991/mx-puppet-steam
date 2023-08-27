import {
	MatrixPresence,
	IFileEvent,
	IMessageEvent,
	IReceiveParams,
	IRemoteRoom,
	IRemoteGroup,
	IRemoteUser,
	IRetList,
	Log,
	PuppetBridge,
	Util, ISendingUser, IPresenceEvent,
} from "mx-puppet-bridge";
import * as SteamUser from "steam-user";
import * as SteamCommunity from "steamcommunity";
import * as SteamID from "steamid";
import {EPersonaState} from "./enum";
import {
	AppInfo,
	IGroupDetails,
	IIncomingChatMessage,
	IIncomingFriendMessage,
	IPersona
} from "./interfaces";
import {debounce} from 'ts-debounce';
import {exportMessageForSending} from "./message";

const log = new Log("MatrixPuppet:Steam");

interface ISteamPuppet {
	client: SteamUser;
	community: SteamCommunity;
	data: any;
	sentEventIds: string[];
	knownPersonas: Map<string, IPersona>,
	knownApps: Map<string, AppInfo>,
	ourSendImages: string[],
	webSessionListeners: (() => void)[],
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
			log.info(`Getting persona for ${steamid}`);
			let {personas} = await p.client.getPersonas([steamid]);
			let persona = personas[steamIdString];
			p.knownPersonas.set(steamIdString, persona);
			return persona;
		}
	}

	public async getProduct(puppetId: number, appId: string): Promise<AppInfo> {
		const p = this.puppets[puppetId];
		let app = p.knownApps.get(appId);
		if (app) {
			return app;
		} else {
			log.info(`Getting product info for ${appId}`);
			let {apps} = await p.client.getProductInfo([parseInt(appId, 10)], []);
			let app: AppInfo = apps[appId];
			log.info(`Got product info for ${appId}: ${app.appinfo.common.name}`);
			p.knownApps.set(appId, app);
			return app;
		}
	}

	public async getFriendMessageSendParams(puppetId: number, msg: IIncomingFriendMessage, fromSteamId?: SteamID): Promise<IReceiveParams> {
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

	public async getChatMessageSendParams(puppetId: number, msg: IIncomingChatMessage, fromSteamId?: SteamID): Promise<IReceiveParams> {
		const p = this.puppets[puppetId];

		let persona = await this.getPersona(p, fromSteamId ? fromSteamId : msg.steamid_sender);

		return {
			room: {
				puppetId,
				roomId: `chat_${msg.chat_group_id}_${msg.chat_id}`,
				isDirect: false,
				name: msg.chat_name,
			},
			user: {
				puppetId,
				userId: fromSteamId ? fromSteamId.toString() : msg.steamid_sender.toString(),
				name: persona.player_name,
				avatarUrl: persona.avatar_url_medium
			},
			eventId: `${msg.server_timestamp.toISOString()}::${msg.ordinal}`,
		} as IReceiveParams;
	}

	public parseChatRoomId(roomId: string): [string, string] {
		let matches = roomId.match(/chat_(\d+)_(\d+)/);
		if (matches) {
			return [matches[1], matches[2]];
		} else {
			throw new Error("invalid chatroom id");
		}
	}

	public getSteamId(puppetId: number): SteamID | null {
		return this.puppets[puppetId].client.steamID;
	}

	public async newPuppet(puppetId: number, data: IPuppetParams) {
		log.info(`Adding new Puppet: puppetId=${puppetId}`);
		if (this.puppets[puppetId]) {
			await this.deletePuppet(puppetId);
		}
		const client = new SteamUser();
		const community = new SteamCommunity();

		this.puppets[puppetId] = {
			client,
			community,
			data,
			sentEventIds: [],
			typingUsers: {},
			knownPersonas: new Map(),
			knownApps: new Map(),
			ourSendImages: [],
			webSessionListeners: [],
		} as ISteamPuppet;
		try {
			client.logOn({
				accountName: data.accountName,
				loginKey: data.loginKey,
				rememberPassword: true,
				logonID: puppetId,
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

					try {
						await this.bridge.setUserPresence({
							puppetId,
							userId: steamId.toString()
						}, state);
					} catch (e) {
						log.error(`Error while setting user presence ${e}`);
					}
				}
			});

			client.on("loggedOn", async (details) => {
				await this.bridge.setUserId(puppetId, client.steamID.toString());

				await this.bridge.sendStatusMessage(puppetId, `connected as ${details.vanity_url}(${client.steamID.toString()})!`);

				client.setPersona(EPersonaState.Away);
			});

			client.on("webSession", async (sessionId, cookies) => {
				log.info("get new webSession");
				community.setCookies(cookies);

				const p = this.puppets[puppetId];
				let listeners = p.webSessionListeners;
				p.webSessionListeners = [];

				for (let listener of listeners) {
					listener();
				}
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
			client.chat.on("chatMessage", (message) => {
				this.handleChatMessage(puppetId, message);
			});
			community.on("sessionExpired", debounce(() => {
				log.warn(`steamcommunity session expired`);
				client.webLogOn();
			}, 60 * 1000));

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

	private getRoomSteamId(room: IRemoteRoom): SteamID | null {
		try {
			const steamId = new SteamID(room.roomId);
			if (steamId.isValid()) {
				return steamId;
			} else {
				return null;
			}
		} catch (e) {
			return null;
		}
	}

	public async handleFriendMessage(puppetId: number, message: IIncomingFriendMessage, fromSteamId?: SteamID) {
		const p = this.puppets[puppetId];
		log.verbose("Got friend message from steam to pass on");

		let sendParams = await this.getFriendMessageSendParams(puppetId, message, fromSteamId);

		await this.sendMessage(p, puppetId, sendParams, message);
	}

	public async handleChatMessage(puppetId: number, message: IIncomingChatMessage, fromSteamId?: SteamID) {
		const p = this.puppets[puppetId];
		log.verbose("Got chat message from steam to pass on");

		let sendParams = await this.getChatMessageSendParams(puppetId, message);

		await this.sendMessage(p, puppetId, sendParams, message);
	}

	public async sendMessage(
		puppet: ISteamPuppet,
		puppetId: number,
		sendParams: IReceiveParams,
		incoming: IIncomingFriendMessage | IIncomingChatMessage
	) {
		const parts = await exportMessageForSending(this, puppetId, incoming);

		for (let part of parts) {
			if (part.kind === "image") {
				const imageUrl = part.urlOrBuffer;
				let i = (typeof imageUrl === "string") ? puppet.ourSendImages.indexOf(imageUrl) : -1;
				if (i === -1) {
					await this.bridge.sendImage(sendParams, imageUrl);
				} else {
					// image came from us, dont send
					puppet.ourSendImages.splice(i);
				}
			} else if (part.kind === "text") {
				await this.bridge.sendMessage(sendParams, {
					body: part.body,
					formattedBody: part.formattedBody,
				});
			}
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
			log.info(`Sending chat message to ${room.roomId}`);
			if (this.getRoomSteamId(room)) {
				const sendMessage = await p.client.chat.sendFriendMessage(room.roomId, msg);
				let id = `${sendMessage.server_timestamp.toISOString()}::${sendMessage.ordinal}`;

				await this.bridge.eventSync.insert(room, eventId, id);
				p.sentEventIds.push(id);
			} else {
				let [groupId, chatId] = this.parseChatRoomId(room.roomId);

				const sendMessage = await p.client.chat.sendChatMessage(groupId, chatId, msg);
				let id = `${sendMessage.server_timestamp.toISOString()}::${sendMessage.ordinal}`;

				await this.bridge.eventSync.insert(room, eventId, id);
				p.sentEventIds.push(id);
			}
		} catch (e) {
			log.error(`Error while sending message ${e}`);
			await this.bridge.sendStatusMessage(room.puppetId, `Error while sending message ${e}`);
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

		let steamId = this.getRoomSteamId(room);
		if (steamId) {
			const bufferPromise = Util.DownloadFile(data.url);
			;

			await new Promise((resolve, _reject) => {
				p.client.webLogOn();
				p.webSessionListeners.push(() => resolve);

				setTimeout(resolve, 2000);
			});

			log.info("webLogOn done");

			const buffer = await bufferPromise;
			try {
				let sendUrl: string = await new Promise((resolve, reject) => p.community.sendImageToUser(steamId, buffer, (err, imageUrl) => {
					if (err) {
						reject(err);
					} else {
						resolve(imageUrl);
					}
				}));
				// since we send images trough SteamCommunity and not SteamUser we get them back as `friendMessageEcho`
				// so we need to track them to make sure we dont double post them
				p.ourSendImages.push(sendUrl);
			} catch (e) {
				log.error(`Error while sending image ${e}`);
				await this.bridge.sendStatusMessage(room.puppetId, `Error while sending image ${e}`);
			}
		} else {
			await this.bridge.sendStatusMessage(room.puppetId, `Sending images to groups is currently not supported`);
		}
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

		let steamId = this.getRoomSteamId(room);
		if (steamId) {
			let persona = await this.getPersona(p, steamId);

			log.info(`Got request to room user ${room.roomId}`);
			return {
				puppetId: room.puppetId,
				roomId: room.roomId,
				isDirect: true,
				name: persona.player_name
			};
		} else {
			let [groupId, chatId] = this.parseChatRoomId(room.roomId);
			let chat_room_group = await this.getGroupInfo(p, groupId);
			if (chat_room_group) {
				let chat_room = chat_room_group.group_summary.chat_rooms.find((chat) => chat.chat_id == chatId);
				let name = chat_room_group.group_summary.chat_group_name;
				if (chat_room) {
					name = `${name} | ${chat_room.chat_name}`;
				}

				return {
					puppetId: room.puppetId,
					roomId: `chat_${groupId}_${chatId}`,
					isDirect: false,
					groupId: groupId,
					name,
					avatarUrl: chat_room_group.group_summary.chat_group_avatar_url,
				};
			}
		}

		await this.bridge.sendStatusMessage(room.puppetId, `Invalid room id or unknown chat: ${room.roomId}`);
		return null;
	}

	public async getGroupInfo(puppet: ISteamPuppet, groupId: string): Promise<IGroupDetails | null> {
		log.info(`Getting group info for ${groupId}`);
		let {chat_room_groups} = await new Promise((resolve, reject) => puppet.client.chat.getGroups((err, response) => {
			if (err) {
				reject(err);
			} else {
				resolve(response);
			}
		})) as {chat_room_groups: {[id: string]: IGroupDetails | null}};

		let chat_room_group = chat_room_groups[groupId];
		if (chat_room_group) {
			return chat_room_group;
		} else {
			return null;
		}
	}

	public async createGroup(group: IRemoteGroup): Promise<IRemoteGroup | null> {
		const p = this.puppets[group.puppetId];
		if (!p) {
			return null;
		}

		let chat_room_group = await this.getGroupInfo(p, group.groupId);

		if (!chat_room_group) {
			return null;
		}

		return {
			puppetId: group.puppetId,
			groupId: group.groupId,
			name: chat_room_group.group_summary.chat_group_name,
			avatarUrl: chat_room_group.group_summary.chat_group_avatar_url,
		};
	}

	public handleMatrixTyping(room: IRemoteRoom, typing: boolean) {
		const p = this.puppets[room.puppetId];
		let steamId = this.getRoomSteamId(room);
		if (steamId && typing) {
			log.info(`sending typing notification to ${steamId}`);
			p.client.chat.sendFriendTyping(steamId);
		}
	}

	public handleMatrixRead(room: IRemoteRoom, eventId: string) {
		const p = this.puppets[room.puppetId];
		log.info(`sending read marker for ${room.roomId}`);
		let steamId = this.getRoomSteamId(room);
		if (steamId) {
			p.client.chat.ackFriendMessage(steamId, new Date());
		} else {
			let [groupId, chatId] = this.parseChatRoomId(room.roomId);
			p.client.chat.ackChatMessage(groupId, chatId, new Date());
		}
	}

	public handleMatrixPresence(puppetId, presence: IPresenceEvent) {
		const p = this.puppets[puppetId];
		if (presence.presence === "offline") {
			p.client.setPersona(EPersonaState.Offline);
		} else if (presence.presence === "online") {
			p.client.setPersona(EPersonaState.Online);
		} else if (presence.presence === "unavailable") {
			p.client.setPersona(EPersonaState.Away);
		}
	}

	public async getEmojiMxc(puppetId: number, type: 'sticker' | 'emoticonlarge', name: string): Promise<string | null> {
		const id = `${type}/${name}`;
		const emoji = await this.bridge.emoteSync.get({
			puppetId,
			emoteId: id,
		});
		if (emoji && emoji.avatarMxc) {
			return emoji.avatarMxc;
		}
		const {emote} = await this.bridge.emoteSync.set({
			puppetId,
			emoteId: id,
			avatarUrl: `https://community.cloudflare.steamstatic.com/economy/${type}/${encodeURIComponent(name)}`,
			name,
			data: {
				type,
				name,
			},
		});
		return emote.avatarMxc || null;
	}
}
