declare module 'steam-user-interfaces' {
	import {EChatEntryType, EChatRoomServerMessage} from "steam-user-enums";
	import SteamId from "steamid";

	export interface IIncomingFriendMessage {
		steamid_friend: SteamId,
		chat_entry_type: EChatEntryType,
		from_limited_account: boolean,
		message: string,
		message_no_bbcode: string,
		server_timestamp: Date,
		ordinal: number,
		local_echo: boolean,
		low_priority: boolean
	}

	export interface IIncomingChatMessage {
		chat_group_id: string,
		chat_id: string,
		steamid_sender: SteamId,
		chat_entry_type: EChatEntryType,
		from_limited_account: boolean,
		message: string,
		message_no_bbcode: string,
		server_timestamp: Date,
		ordinal: number,
		mentions: IChatMentions | null,
	}

	export interface IChatMentions {
		mention_all: boolean,
		mention_here,
		mention_steamids: SteamId[]
	}

	export interface IServerMessage {
		message: EChatRoomServerMessage,
		string_param?: string,
		steamid_param?: SteamId
	}

	// incomplete
	export interface IPersona {
		player_name: string,
		avatar_hash: Buffer,
		last_logoff: Date,
		last_logon: Date,
		last_seen_online: Date,
		game_name: string,
		avatar_url_icon: string,
		avatar_url_medium: string,
		avatar_url_full: string
	}
}
