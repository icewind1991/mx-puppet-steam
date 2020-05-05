/// <reference path="@types/steam-user/enum.d.ts" />
/// <reference path="@types/steam-user/interfaces.d.ts" />

import {
	PuppetBridge,
	Log,
	IReceiveParams,
	IRemoteRoom,
	IRemoteUser,
	IMessageEvent,
	IFileEvent,
	Util,
	IRetList,
} from "mx-puppet-bridge";
import * as SteamUser from "steam-user";
import * as SteamID from "steamid";
import {IIncomingFriendMessage, IPersona} from "steam-user-interfaces";

const log = new Log("MatrixPuppet:Steam");

interface ISteamPuppet {
	client: SteamUser;
	data: any;
	sentEventIds: string[];
	knownPersonas: Map<string, IPersona>,
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
		let persona = p.knownPersonas.get(steamIdString)
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
		} as ISteamPuppet;
		try {
			client.logOn({
				accountName: data.accountName,
				loginKey: data.loginKey,
				rememberPassword: true,
			});

			client.on("user", (steamId, persona) => {
				this.puppets[puppetId].knownPersonas.set(steamId.toString(), persona);
			});

			client.on("loggedOn", async (details) => {
				await this.bridge.setUserId(puppetId, client.steamID.toString());

				await this.bridge.sendStatusMessage(puppetId, `connected as ${details.vanity_url}(${client.steamID.toString()})!`);
			})

			client.on("loginKey", (loginKey) => {
				console.log("got new login key");
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
			})

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

		await this.bridge.sendMessage(await this.getSendParams(puppetId, message, fromSteamId), {
			body: message.message,
		});
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
		let id = "";

		try {
			let _roomSteamId = new SteamID(room.name as string);
			if (_roomSteamId.isValid()) {
				const sendMessage = await p.client.chat.sendFriendMessage(room.roomId, msg);
				id = `${sendMessage.server_timestamp.toISOString()}::${sendMessage.ordinal}`;
			} else {
				await this.bridge.sendStatusMessage(room.puppetId, `Sending group messages is currently not supported`);
			}
		} catch (e) {
			await this.bridge.sendStatusMessage(room.puppetId, `Sending group messages is currently not supported`);
		}

		await this.bridge.eventSync.insert(room, eventId, id);
		p.sentEventIds.push(id);
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
		log.info(`Got request to create user ${user.userId}`);
		return {
			userId: user.userId,
			puppetId: user.puppetId,
			name: user.name,
		};
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
