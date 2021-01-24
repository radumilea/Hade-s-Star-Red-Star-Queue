require("dotenv").config();
const Discord = require('discord.js')

const PREFIX = '!';
const EMOJI_JOIN = '⚔️';
const EMOJI_CANCEL = '❌';
const EMPTY_SLOT_SYMBOL = '-';

const Q_TIMEOUT_T = 1000 * 60 * 60;
const Q_SLOT_1 = 0;
const Q_SLOT_2 = 1;
const Q_SLOT_3 = 2;
const Q_SLOT_4 = 3;

const client = new Discord.Client({
  partials: ['MESSAGE', 'REACTION']
});

client.on('ready', () => {
  logger('Init', `${client.user.tag} has logged in.`);
});

client.on('message', async (message) => {
  // ignore messages made by bots
  if (message.author.bot) return;
  // validate prefix & extarct args
  if (message.content.startsWith(PREFIX)) {
    const [CMD_NAME, ...args] = message.content
      .trim()
      .substring(PREFIX.length)
      .split(/\s+/);
    if (CMD_NAME === 'curcubeu') {
      // check game mod
      if (args.length === 0) {
        tipsMessage(message, `
Pentru a continua este necesar să alegi un tip de joc. Tipuri de joc diponibile: \`RS\` (Red Star)

**Red Star Search**
Pentru a anunța un RS este necesar să folosești comanda \`!curcubeu\` la care să adaugi tipul de joc (RS) și RS lvl-ul dorit (\`3,4,5,6,7,8,9,10 sau 11\`)

Comandă: \`!curcubeu RS <RS LVL>\`
Exemplu pentru Red Star lvl 3: \`!curcubeu RS 3\`
Exemplu pentru Red Star lvl 7: \`!curcubeu RS 7\`
        `, 0);
        return;
      } else {
        const command = args[0].toUpperCase();
        if(command === 'RS') {
          // do red star
          if (args[1]) {
            const redStarLvl = parseInt(args[1]);
            // check if red star lvl is valid
            if (Number.isInteger(redStarLvl) && redStarLvl >= 3 && redStarLvl <= 11) {
              doRedStar(message, redStarLvl);
            } else {
              return invalidRedStarLvl(message);
            }
          } else {
            return invalidRedStarLvl(message);
          }
        } else {
          // display invalid mode
tipsMessage(message, `
**Tipul de joc nu este corect!**
Tipuri de joc diponibile: \`RS\` (Red Star)

**Red Star Search**
Pentru a anunța un RS este necesar să folosești comanda \`!curcubeu\` la care să adaugi tipul de joc (\`RS\`) și RS lvl-ul dorit (\`3,4,5,6,7,8,9,10 sau 11\`)

Comandă: \`!curcubeu RS <RS LVL>\`
Exemplu pentru Red Star lvl 3: \`!curcubeu RS 3\`
Exemplu pentru Red Star lvl 7: \`!curcubeu RS 7\`

* *mesajul se autodistruge în 3 minute*
`, 3, true);
        }
      } 
    } 
  }
});

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

const reactionFilter = reaction => {
  return reaction.emoji.name === EMOJI_JOIN || reaction.emoji.name === EMOJI_CANCEL;
}

async function doRedStar(message, redStarLevel) {
  logger('RedStar Search', `${message.author.username} - RS ${redStarLevel}`);

  // send Q message
  const sendEmbedIntro = await message.channel.send(buildQMessageIntro(message, redStarLevel));
  const sendEmbed = message.channel.send(buildQMessage(message, redStarLevel));
  logger('Q', `${message.author.username} - RS ${redStarLevel} | Send embed`);

  sendEmbed.then((searchMessage) => {
    // cache embed
    let currentEmbed = searchMessage.embeds[0];
    
    // delete Q after 1h
    let QAutoDestroy = setTimeout(() => {
      sendEmbedIntro.delete({ timeout: 1 });
      searchMessage.delete({ timeout: 1 });
      sendQAutoDestroyMessage(message, currentEmbed, redStarLevel);
      logger('Q', `${message.author.username} - RS ${redStarLevel} | Destroy Q on timeout`);
    }, Q_TIMEOUT_T);

    // add reactions to Q embed
    searchMessage.react(EMOJI_JOIN);
    searchMessage.react(EMOJI_CANCEL);

    // init reaction watcher
    const reactionCollector = new Discord.ReactionCollector(searchMessage, reactionFilter, { dispose: true });
    reactionCollector.on('collect', (reaction, user) => {
      // ignore reactions made by bots
      if (user.bot) {
        return;
      }

      const isQAuth = isQAuthor(message, user);

      if (reaction.emoji.name === EMOJI_JOIN && !isQAuth) {
        currentEmbed = addPlayerToQAdnReturnNewEmbed(searchMessage, currentEmbed, user);
        searchMessage.edit(currentEmbed);
        logger('Q', `${message.author.username} - RS ${redStarLevel} | Add ${user.username} to Q`);

        // Check if game is rdy
        if (isRsQRdy(currentEmbed)) {
          clearTimeout(QAutoDestroy);
          sendEmbedIntro.delete({ timeout: 1 });
          searchMessage.delete({ timeout: 1 });
          sendRsReadyMessage(message, currentEmbed, redStarLevel);
          logger('Q', `${message.author.username} - RS ${redStarLevel} | Q is rdy`);
        }
      }

      if (reaction.emoji.name === EMOJI_CANCEL && isQAuth) {
        clearTimeout(QAutoDestroy);
        sendEmbedIntro.delete({ timeout: 1 });
        searchMessage.delete({ timeout: 1 });
        sendCancelQMessage(message, currentEmbed, redStarLevel);
        logger('Q', `${message.author.username} - RS ${redStarLevel} | Delete Q`);
      }
    });

    reactionCollector.on('remove', (reaction, user) => {
      // ignore reactions made by bots
      if (user.bot) {
        return;
      }

      const isQAuth = isQAuthor(message, user);

      if (reaction.emoji.name === EMOJI_JOIN && !isQAuth) {
        currentEmbed = removePlayerFromQAdnReturnNewEmbed(searchMessage, currentEmbed, user);
        searchMessage.edit(currentEmbed);
        logger('Q', `${message.author.username} - RS ${redStarLevel} | Remove ${user.username} from Q`);
      }
    });
  });  
}

function tipsMessage(message, textToSend, timeoutMinutes = 3, deleteUserMessage = false) {
  message.reply(textToSend).then((response) => {
    if (timeoutMinutes > 0) {
      // delete bot response
      response.delete({ timeout: 1000 * 60 * timeoutMinutes });
      // delete bot response
      if (deleteUserMessage) {
        message.delete({ timeout: 1000 * 60 * timeoutMinutes });
      }
    }
  });
}

function isQAuthor(message, user) {
  return message.author.id === user.id;
}

function removePlayerFromQAdnReturnNewEmbed(searchMessage, currentEmbed, user) {
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
  return newEmbed;
}

function sendQAutoDestroyMessage(message, embed, redStarLevel) {
  let text = `Timpul de căutare pentru RS ${redStarLevel} a expirat!\n`;
  
  const { fields } = embed;
  if (fields[Q_SLOT_1].value !== EMPTY_SLOT_SYMBOL) {
    text += fields[Q_SLOT_1].value;
  }
  if (fields[Q_SLOT_2].value !== EMPTY_SLOT_SYMBOL) {
    text += ', ' + fields[Q_SLOT_2].value;
  }
  if (fields[Q_SLOT_3].value !== EMPTY_SLOT_SYMBOL) {
    text += ', ' + fields[Q_SLOT_3].value;
  }
  if (fields[Q_SLOT_4].value !== EMPTY_SLOT_SYMBOL) {
    text += ', ' + fields[Q_SLOT_4].value;
  }
  message.channel.send(text);
}

function sendCancelQMessage(message, embed, redStarLevel) {
  const { fields } = embed;
  let text = '';
  hasPlayers = false;

  if (fields[Q_SLOT_2].value !== EMPTY_SLOT_SYMBOL) {
    text += fields[Q_SLOT_2].value;
    hasPlayers = true;
  }
  if (fields[Q_SLOT_3].value !== EMPTY_SLOT_SYMBOL) {
    text += ', ' + fields[Q_SLOT_3].value;
    hasPlayers = true;
  }
  if (fields[Q_SLOT_4].value !== EMPTY_SLOT_SYMBOL) {
    text += ', ' + fields[Q_SLOT_4].value;
    hasPlayers = true;
  }
  if (hasPlayers) {
    text += ': ';
  }

  text += `${fields[Q_SLOT_1].value} a închis căutarea pentru **RS ${redStarLevel}** !`; 
  message.channel.send(text);
}

function sendRsReadyMessage(message, embed, redStarLevel) {
  const { fields } = embed;
  const text = `Țară, țară, avem ostași! \n${fields[Q_SLOT_1].value}, ${fields[Q_SLOT_2].value}, ${fields[Q_SLOT_3].value}, ${fields[Q_SLOT_4].value}, sunteți pregătiți să începem RS ${redStarLevel} ?`; 
  message.channel.send(text);
}

function isRsQRdy(embed) {
  const { fields } = embed;
  if (fields[Q_SLOT_1].value !== EMPTY_SLOT_SYMBOL && fields[Q_SLOT_2].value !== EMPTY_SLOT_SYMBOL && fields[Q_SLOT_3].value !== EMPTY_SLOT_SYMBOL && fields[Q_SLOT_4].value !== EMPTY_SLOT_SYMBOL) {
    return true;
  } else {
    return false;
  }
}

function addPlayerToQAdnReturnNewEmbed(message, currentEmbed, user) {
  let newEmbed = new Discord.MessageEmbed(currentEmbed);
  const username = `<@${user.id}>`;

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
  return newEmbed;
}

function logger(zone, message) {
  console.log(`[${zone}] ${message}`);
}

function buildQMessage(message, redStarLevel) {
  return new Discord.MessageEmbed()
  .setTitle(`[Search] Red Star LVL ${redStarLevel}`)
  .setColor(`#00A3E0`)
  .setAuthor(message.author.username)
  .setTimestamp()
  .setThumbnail('https://firebasestorage.googleapis.com/v0/b/personalpublic-ae1da.appspot.com/o/discord%2Fjupiter.png?alt=media&token=fd26f1cf-1cbb-45ea-a3d9-99fd34fb4a82')
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
      value: `*Reacționează cu ${EMOJI_JOIN} pentru a da join. \n*Reacționează cu ${EMOJI_CANCEL} pentru a închide căutarea (owner only).`,
      inline: false,
    },
  );
}

function buildQMessageIntro(message, redStarLevel) {
  return `@everyone, ${message.author} caută oameni pentru **RS ${redStarLevel} !**\nŢară, ţară, vrem ostaşi!\n*Căutarea se închide automat în 1h.`;
}

client.login(process.env.DISCORDJS_BOT_TOKEN);
