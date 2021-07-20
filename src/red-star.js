const UTIL = require('./util');

let Discord;

const EMOJI_JOIN = '⚔️';
const EMOJI_START = '🦸🏿‍♂️';
const EMOJI_CANCEL = '❌';
const EMOJI_GO_TOP = ':point_up_2:';
const EMPTY_SLOT_SYMBOL = '-';


const Q_TIMEOUT_T = 1000 * 60 * 60;
const Q_SLOT_1 = 0;
const Q_SLOT_2 = 1;
const Q_SLOT_3 = 2;
const Q_SLOT_4 = 3;

const Q_SLOT_FOR_INFO = 4;

const Q_THUMBNAIL_IN_PROGRESS = 'https://firebasestorage.googleapis.com/v0/b/personalpublic-ae1da.appspot.com/o/discord%2Fcheerleaders.png?alt=media&token=aac3f437-87b1-49be-b446-a9015f64cb57';
const Q_THUMBNAIL_SUCCESS = 'https://firebasestorage.googleapis.com/v0/b/personalpublic-ae1da.appspot.com/o/discord%2Fswords(2).png?alt=media&token=d22f538a-bc45-4a89-a497-3c3c68e2e4af';
const Q_THUMBNAIL_CLOSED = 'https://firebasestorage.googleapis.com/v0/b/personalpublic-ae1da.appspot.com/o/discord%2Fshipwreck.png?alt=media&token=c9fc0e34-6296-49bf-a78c-73d04b7bbce1';

const GOOD_NOTIFICATION_COLOR = '#57F287';
const WARNING_NOTIFICATION_COLOR = '#FEE75C';
const SUCCESS_NOTIFICATION_COLOR = '#00a800';
const BAD_NOTIFICATION_COLOR = '#ED4245';

const RS_EMBED_TITLE = '[%playerCount%/4] RS %redStarLevel% Matchmaking'; 

const RS_LVLS = {
  3: {
    color: '#78D64B',
  },
  4: {
    color: '#00B140',
  },
  5: {
    color: '#3CDBC0',
  },
  6: {
    color: '#00A3E0',
  },
  7: {
    color: '#FFA400',
  },
  8: {
    color: '#FF6900',
  },
  9: {
    color: '#FA4616',
  },
  10: {
    color: '#FA4616',
  },
  11: {
    color: '#FA4616',
  },
}

async function doRedStar(discordRef, message, redStarLevel) {
  Discord = discordRef;
  UTIL.logger('RedStar Search', `${message.author.username} - RS ${redStarLevel}`);

  // send Q message
  // await message.channel.send(buildQMessageIntro(message, redStarLevel));
  const sendEmbed = message.channel.send(buildQMessage(message, redStarLevel));
  UTIL.logger('Q', `${message.author.username} - RS ${redStarLevel} | Send embed`);

  sendEmbed.then((searchMessage) => {
    // cache embed
    let currentEmbed = searchMessage.embeds[0];

    // add reactions to Q embed
    try {
      searchMessage.react(EMOJI_JOIN);
      searchMessage.react(EMOJI_START);
      searchMessage.react(EMOJI_CANCEL);
    } catch(err) {
      UTIL.logger('ERROR', `${message.author.username} - RS ${redStarLevel} | Can't react to message`);
      console.log(err);
    }
    
    // init reaction watcher
    const reactionCollector = new Discord.ReactionCollector(searchMessage, reactionFilter, { dispose: true });

    // delete Q after 1h
    let QAutoDestroy = setTimeout(() => {
      // Stop reaction watcher
      reactionCollector.stop();
      // Update embed with status "CLOSED"
      currentEmbed = editEmbedForClose(currentEmbed, redStarLevel, false);
      searchMessage.edit(currentEmbed).catch((err) => {
        UTIL.logger('ERROR', `${message.author.username} - RS ${redStarLevel} | Can't edit embed message`);
        console.log(err);
      });
      // send destroy message
      sendQAutoDestroyMessage(message, currentEmbed, redStarLevel, searchMessage);
      UTIL.logger('Q', `${message.author.username} - RS ${redStarLevel} | Destroy Q on timeout`);
    }, Q_TIMEOUT_T);

    reactionCollector.on('collect', (reaction, user) => {
      // ignore reactions made by bots
      if (user.bot) {
        return;
      }

      const isQAuth = isQAuthor(message, user);

      if (reaction.emoji.name === EMOJI_JOIN && !isQAuth) {
        currentEmbed = addPlayerToQAdnReturnNewEmbed(searchMessage, currentEmbed, user, redStarLevel);
        searchMessage.edit(currentEmbed).catch((err) => {
          UTIL.logger('ERROR', `${message.author.username} - RS ${redStarLevel} | Can't edit embed message`);
          console.log(err);
        });
        UTIL.logger('Q', `${message.author.username} - RS ${redStarLevel} | Add ${user.username} to Q`);

        // execute this after the embed is updated
        const qMembersCount = getQMembersCount(currentEmbed);
        const qMembersList = getQMembersAsList(currentEmbed);
        const searchMessageUrl = getSearchMessageUrl(searchMessage);

        // Check if game is rdy
        if (qMembersCount === 4) {
          // Stop reaction watcher
          reactionCollector.stop();
          // Stop Q timeout
          clearTimeout(QAutoDestroy);
          sendRsReadyMessage(message, user, redStarLevel, qMembersCount, qMembersList, searchMessageUrl);
          UTIL.logger('Q', `${message.author.username} - RS ${redStarLevel} | Q is rdy`);
        } else {
          sendNewUserJoinedMessage(message, user, redStarLevel, qMembersCount, qMembersList, searchMessageUrl);
        }
      }

      if (reaction.emoji.name === EMOJI_START && isQAuth) {
        UTIL.logger('Q', `${message.author.username} - RS ${redStarLevel} | Start Game`);
        // Stop reaction watcher
        reactionCollector.stop();
        // Stop Q timeout
        clearTimeout(QAutoDestroy);
        // Update embed with status "CLOSED"
        currentEmbed = editEmbedForClose(currentEmbed, redStarLevel, true);
        searchMessage.edit(currentEmbed).catch((err) => {
          UTIL.logger('ERROR', `${message.author.username} - RS ${redStarLevel} | Can't edit embed message`);
          console.log(err);
        });
        sendStartQMessage(message, currentEmbed, redStarLevel, searchMessage);
      }

      if (reaction.emoji.name === EMOJI_CANCEL && isQAuth) {
        UTIL.logger('Q', `${message.author.username} - RS ${redStarLevel} | Delete Q`);
        // Stop reaction watcher
        reactionCollector.stop();
        // Stop Q timeout
        clearTimeout(QAutoDestroy);
        // Update embed with status "CLOSED"
        currentEmbed = editEmbedForClose(currentEmbed, redStarLevel, false);
        searchMessage.edit(currentEmbed).catch((err) => {
          UTIL.logger('ERROR', `${message.author.username} - RS ${redStarLevel} | Can't edit embed message`);
          console.log(err);
        });
        // Send cancel Q notification
        sendCancelQMessage(message, currentEmbed, redStarLevel, searchMessage);
      }
    });

    reactionCollector.on('remove', (reaction, user) => {
      // ignore reactions made by bots
      if (user.bot) {
        return;
      }

      const isQAuth = isQAuthor(message, user);

      if (reaction.emoji.name === EMOJI_JOIN && !isQAuth) {
        currentEmbed = removePlayerFromQAdnReturnNewEmbed(searchMessage, currentEmbed, user, redStarLevel);
        searchMessage.edit(currentEmbed).catch((err) => {
          UTIL.logger('ERROR', `${message.author.username} - RS ${redStarLevel} | Can't edit embed message`);
          console.log(err);
        });

        const qMembersCount = getQMembersCount(currentEmbed);
        const qMembersList = getQMembersAsList(currentEmbed);
        const searchMessageUrl = getSearchMessageUrl(searchMessage);

        sendUserLeftMessage(message, user, redStarLevel, qMembersCount, qMembersList, searchMessageUrl);
        UTIL.logger('Q', `${message.author.username} - RS ${redStarLevel} | Remove ${user.username} from Q`);
      }
    });
  });  
}

function getSearchMessageUrl(searchMessage) {
  const messageId = searchMessage.id;
  const channelId = searchMessage.channel.id;
  const guildId = searchMessage.channel.guild.id;
  return `https://discordapp.com/channels/${guildId}/${channelId}/${messageId}`;
}

function editEmbedForClose(currentEmbed, redStarLevel, success = false) {
  let newEmbed = new Discord.MessageEmbed(currentEmbed);

  // UPDATE EMBED TITLE
  newEmbed.title = returnEmbedTitle(0, redStarLevel);

  // UPDATE FIELDS
  newEmbed = newEmbed.spliceFields(Q_SLOT_FOR_INFO, 1);

  // UPDATE THUMBNAIL
  if (success) {
    newEmbed.setThumbnail(Q_THUMBNAIL_SUCCESS);
  } else {
    newEmbed.setThumbnail(Q_THUMBNAIL_CLOSED);
  }

  return newEmbed;
}

function invalidRedStarLvl(message) {
  return tipsMessage(message, `
**LVL-ul Red Star-ului nu este corect sau lipseste!**

Pentru a anunța un RS este necesar să folosești comanda \`!curcubeu\` la care să adaugi tipul de joc (\`RS\`) și RS lvl-ul dorit (\`3,4,5,6,7,8,9,10 sau 11\`)

Comandă: \`!curcubeu RS <RS LVL>\`
Exemplu pentru Red Star lvl 3: \`!curcubeu RS 3\`
Exemplu pentru Red Star lvl 7: \`!curcubeu RS 7\`  

* *mesajul se autodistruge în 3 minute*
  `, 3, true);
}

function isQAuthor(message, user) {
  return message.author.id === user.id;
}

function removePlayerFromQAdnReturnNewEmbed(searchMessage, currentEmbed, user, redStarLevel) {
  let newEmbed = new Discord.MessageEmbed(currentEmbed);
  const username = `<@${user.id}>`;

  const { fields } = currentEmbed;
  if (fields[Q_SLOT_1].value === username) {
    fields[Q_SLOT_1].value = EMPTY_SLOT_SYMBOL;
  } else if (fields[Q_SLOT_2].value === username) {
    fields[Q_SLOT_2].value = EMPTY_SLOT_SYMBOL;
  } else if (fields[Q_SLOT_3].value === username) {
    fields[Q_SLOT_3].value = EMPTY_SLOT_SYMBOL;
  } else if (fields[Q_SLOT_4].value === username) {
    fields[Q_SLOT_4].value = EMPTY_SLOT_SYMBOL;
  }
  newEmbed.fields = fields;

  // UPDATE TITLE
  const playerCount = getQMembersCount(newEmbed);
  newEmbed.title = returnEmbedTitle(playerCount, redStarLevel);

  return newEmbed;
}

function sendNewUserJoinedMessage(message, user, redStarLevel, qMembersCount, qMembersList, searchMessageUrl) {
  let description = `In matchmaking queue: ${qMembersList}`;
  if (qMembersCount === 3) {
    description += '\nFYI: @everyone';
  }
  const embed = new Discord.MessageEmbed()
  .setColor(GOOD_NOTIFICATION_COLOR)
  .setTitle(`[${qMembersCount}/4 RS ${redStarLevel}] ${user.username} joined the queue! ${EMOJI_GO_TOP}`)
  .setURL(searchMessageUrl)
  .setDescription(description);
  
  message.channel.send(embed);
}

function sendUserLeftMessage(message, user, redStarLevel, qMembersCount, qMembersList, searchMessageUrl) {
  let description = `In matchmaking queue: ${qMembersList}`;

  const embed = new Discord.MessageEmbed()
  .setColor(WARNING_NOTIFICATION_COLOR)
  .setTitle(`[${qMembersCount}/4 RS ${redStarLevel}] ${user.username} has left the queue! ${EMOJI_GO_TOP}`)
  .setURL(searchMessageUrl)
  .setDescription(description);
  
  message.channel.send(embed);
}

function getQMembersAsList(embed) {
  let members = '';
  const { fields } = embed;
  if (fields[Q_SLOT_1].value !== EMPTY_SLOT_SYMBOL) {
    members += fields[Q_SLOT_1].value;
  }
  if (fields[Q_SLOT_2].value !== EMPTY_SLOT_SYMBOL) {
    members += ', ' + fields[Q_SLOT_2].value;
  }
  if (fields[Q_SLOT_3].value !== EMPTY_SLOT_SYMBOL) {
    members += ', ' + fields[Q_SLOT_3].value;
  }
  if (fields[Q_SLOT_4].value !== EMPTY_SLOT_SYMBOL) {
    members += ', ' + fields[Q_SLOT_4].value;
  }
  return members;
}

function sendQAutoDestroyMessage(message, currentEmbed, redStarLevel, searchMessage) {
  const qMembersCount = getQMembersCount(currentEmbed);
  const qMembersList = getQMembersAsList(currentEmbed);
  const searchMessageUrl = getSearchMessageUrl(searchMessage);

  const notification = new Discord.MessageEmbed()
  .setColor(BAD_NOTIFICATION_COLOR)
  .setTitle(`[${qMembersCount}/4 RS ${redStarLevel}] Matchmaking has expired! Try again?`)
  .setURL(searchMessageUrl)
  .setDescription(`FYI: ${qMembersList}`);
  
  message.channel.send(notification);
}

function sendStartQMessage(message, currentEmbed, redStarLevel, searchMessage) {
  const qMembersCount = getQMembersCount(currentEmbed);
  const qMembersList = getQMembersAsList(currentEmbed);
  const searchMessageUrl = getSearchMessageUrl(searchMessage);

  const notification = new Discord.MessageEmbed()
  .setColor(SUCCESS_NOTIFICATION_COLOR)
  .setTitle(`[${qMembersCount}/4 RS ${redStarLevel}] Matchmaking ready! Let's play!`)
  .setURL(searchMessageUrl)
  .setDescription(`Team members: ${qMembersList}`);
  
  message.channel.send(notification);
}

function sendCancelQMessage(message, currentEmbed, redStarLevel, searchMessage) {
  const qMembersCount = getQMembersCount(currentEmbed);
  const qMembersList = getQMembersAsList(currentEmbed);
  const searchMessageUrl = getSearchMessageUrl(searchMessage);

  const notification = new Discord.MessageEmbed()
  .setColor(BAD_NOTIFICATION_COLOR)
  .setTitle(`[${qMembersCount}/4 RS ${redStarLevel}] Matchmaking closed by ${message.author.username}`)
  .setURL(searchMessageUrl)
  .setDescription(`FYI: ${qMembersList}`);
  
  message.channel.send(notification);
}

function sendRsReadyMessage(message, user, redStarLevel, qMembersCount, qMembersList, searchMessageUrl) {
  const notification = new Discord.MessageEmbed()
  .setColor(SUCCESS_NOTIFICATION_COLOR)
  .setTitle(`[${qMembersCount}/4 RS ${redStarLevel}] Matchmaking ready! Let's play!`)
  .setURL(searchMessageUrl)
  .setDescription(`Team members: ${qMembersList}`);
  
  message.channel.send(notification);
}

function getQMembersCount(embed) {
  const { fields } = embed;
  let qCount = 0;
  if (fields[Q_SLOT_1].value !== EMPTY_SLOT_SYMBOL) {
    qCount++;
  }
  if (fields[Q_SLOT_2].value !== EMPTY_SLOT_SYMBOL) {
    qCount++;
  }
  if (fields[Q_SLOT_3].value !== EMPTY_SLOT_SYMBOL) {
    qCount++;
  }
  if (fields[Q_SLOT_4].value !== EMPTY_SLOT_SYMBOL) {
    qCount++;
  }

  return qCount;
}

function addPlayerToQAdnReturnNewEmbed(message, currentEmbed, user, redStarLevel) {
  let newEmbed = new Discord.MessageEmbed(currentEmbed);
  const username = `<@${user.id}>`;

  // UPDATE PLAYERS FIELDS
  const { fields } = currentEmbed;
  if (fields[Q_SLOT_1].value === EMPTY_SLOT_SYMBOL) {
    fields[Q_SLOT_1].value = username;
  } else if (fields[Q_SLOT_2].value === EMPTY_SLOT_SYMBOL) {
    fields[Q_SLOT_2].value = username;
  } else if (fields[Q_SLOT_3].value === EMPTY_SLOT_SYMBOL) {
    fields[Q_SLOT_3].value = username;
  } else if (fields[Q_SLOT_4].value === EMPTY_SLOT_SYMBOL) {
    fields[Q_SLOT_4].value = username;
  }
  newEmbed.fields = fields;

  // UPDATE TITLE
  const playerCount = getQMembersCount(newEmbed);
  newEmbed.title = returnEmbedTitle(playerCount, redStarLevel);

  if (playerCount === 4) {
    newEmbed.setThumbnail(Q_THUMBNAIL_SUCCESS);
    // UPDATE FIELDS
    newEmbed = newEmbed.spliceFields(Q_SLOT_FOR_INFO, 1);
  }

  return newEmbed;
}

function returnEmbedTitle(playerCount, redStarLevel) {
    let newTitle = RS_EMBED_TITLE;
    newTitle = newTitle.replace('%playerCount%', playerCount);
    newTitle = newTitle.replace('%redStarLevel%', redStarLevel);

    if (playerCount === 0 || playerCount === 4){
      return '[CLOSED]' + newTitle.slice(5);
    }

    return newTitle;
}

function buildQMessage(message, redStarLevel) {
  const embedTitle = returnEmbedTitle(1, redStarLevel);
  return new Discord.MessageEmbed()
  .setTitle(embedTitle)
  .setColor(RS_LVLS[redStarLevel].color)
  .setTimestamp()
  .setThumbnail(Q_THUMBNAIL_IN_PROGRESS)
  .setFooter('Curcubeu / CurcubeuAcademy')
  .addFields(
    {
      name: 'Slot 1',
      value: `<@${message.author.id}>`,
      inline: false,
    },
    {
      name: 'Slot 2',
      value: EMPTY_SLOT_SYMBOL,
      inline: false,
    },
    {
      name: 'Slot 3',
      value: EMPTY_SLOT_SYMBOL,
      inline: false,
    },
    {
      name: 'Slot 4',
      value: EMPTY_SLOT_SYMBOL,
      inline: false,
    },
    {
      name: '\u200B',
      value: `*@everyone: Use ${EMOJI_JOIN} to join.* \n*<@${message.author.id}>: Use ${EMOJI_START} to start earlier or ${EMOJI_CANCEL} to close the queue.*\n\n * *Matchmaking will expire in 1h*`,
      inline: false,
    },
  );
}

const reactionFilter = reaction => {
  return reaction.emoji.name === EMOJI_JOIN || reaction.emoji.name === EMOJI_CANCEL || reaction.emoji.name === EMOJI_START;
}

module.exports = { doRedStar, invalidRedStarLvl };
