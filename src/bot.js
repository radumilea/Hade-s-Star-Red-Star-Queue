require("dotenv").config();
const Discord = require('discord.js')

const PREFIX = '!';
const EMOJI_JOIN = '⚔️';
const EMOJI_CANCEL = '❌';

const Q_SLOT_1 = 0;
const Q_SLOT_2 = 1;
const Q_SLOT_3 = 2;
const Q_SLOT_4 = 3;

const client = new Discord.Client({
  partials: ['MESSAGE', 'REACTION']
});

client.on('ready', () => {
  console.log(`${client.user.tag} has logged in.`);
});


client.on('message', async (message) => {
  if (message.author.bot) return;
  if (message.content.startsWith(PREFIX)) {
    const [CMD_NAME, ...args] = message.content
      .trim()
      .substring(PREFIX.length)
      .split(/\s+/);
    if (CMD_NAME === 'curcubeu') {
      if (args.length === 0) {
        tipsMessage(message, 'Te rog sa alegi un tip de joc. Tipuri de joc disponibile: RS');
        return;
      } else {
        console.log('args',args);
        const command = args[0].toUpperCase();
        if(command === 'RS') {
          if (args[1]) {
            const redStarLvl = parseInt(args[1]);
            if (Number.isInteger(redStarLvl) && redStarLvl >= 1 && redStarLvl <= 11) {
              doRedStar(message, redStarLvl);
            } else {
              return invalidRedStarLvl(message);
            }
          } else {
            return invalidRedStarLvl(message);
          }
        }
      } 
    } 
  }
});

function invalidRedStarLvl(message) {
  return tipsMessage(message, 'Te rog sa adaugi lvl-ul red star-ului.');
}


const reactionFilter = reaction => {
  return reaction.emoji.name === EMOJI_JOIN || reaction.emoji.name === EMOJI_CANCEL;
}

async function doRedStar(message, redStarLevel) {
  console.log(`[RedStar Search] ${message.author.username} - RS ${redStarLevel}`);

  await message.channel.send(`@everyone, ${message.author} cauta oameni pentru **RS${redStarLevel}!**\nTara, tara, vrem ostasi\n*Cautarea se inchide automat in 1h.`);

  const embed = new Discord.MessageEmbed()
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
        value: '-',
        inline: false,
      },
      // {
      //   name: '\u200B',
      //   value: '\u200B',
      //   inline: true,
      // },
      {
        name: 'Slot 3',
        value: '-',
        inline: false,
      },
      {
        name: 'Slot 4',
        value: '-',
        inline: false,
      },
      {
        name: '\u200B',
        value: `Reactioneaza cu ${EMOJI_JOIN} pentru a da join. \nReactioneaza cu ${EMOJI_CANCEL} pentru a inchide cautarea (owner only).`,
        inline: false,
      },
    );
  // message.react('🏳️‍🌈');
  const sendEmbed = message.channel.send(embed);
  sendEmbed.then((searchMessage) => {
    // cache embed
    let currentEmbed = searchMessage.embeds[0];
    
    // delete q after 1h
    let QAutoDestroy = setTimeout(() => {
      searchMessage.delete({ timeout: 1 });
      sendQAutoDestroyMessage(message, currentEmbed, redStarLevel);
    }, 1000 * 60 * 60);

    // add reactions to search post
    searchMessage.react(EMOJI_JOIN);
    searchMessage.react(EMOJI_CANCEL);

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

        // Check if game is rdy
        if (isRsQRdy(currentEmbed)) {
          clearTimeout(QAutoDestroy);
          searchMessage.delete({ timeout: 1 });
          sendRsReadyMessage(message, currentEmbed, redStarLevel);
        }
      }

      if (reaction.emoji.name === EMOJI_CANCEL && isQAuth) {
        clearTimeout(QAutoDestroy);
        searchMessage.delete({ timeout: 1 });
        sendCancelQMessage(message, currentEmbed, redStarLevel);
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
      }
    });
  });  
}

function tipsMessage(message, textToSend, deleteUserMessage = false) {
  message.reply(textToSend).then((response) => {
    // delete bot response
    response.delete({ timeout: 1000 * 60 * 1 });
    // delete bot response
    if (deleteUserMessage) {
      message.delete({ timeout: 1000 * 60 * 1 });
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
    fields[Q_SLOT_1].value = '-';
  } else if (fields[Q_SLOT_2].value === username) {
    fields[Q_SLOT_2].value = '-';
  } else if (fields[Q_SLOT_3].value === username) {
    fields[Q_SLOT_3].value = '-';
  } else if (fields[Q_SLOT_4].value === username) {
    fields[Q_SLOT_4].value = '-';
  }

  newEmbed.fields = fields;
  return newEmbed;
}

function sendQAutoDestroyMessage(message, embed, redStarLevel) {
  const { fields } = embed;

  let text = `Timpul de cautare pentru RS${redStarLevel} a expirat!  \n`;

  if (fields[Q_SLOT_1].value !== '-') {
    text += fields[Q_SLOT_1].value;
  }
  if (fields[Q_SLOT_2].value !== '-') {
    text += ', ' + fields[Q_SLOT_2].value;
  }
  if (fields[Q_SLOT_3].value !== '-') {
    text += ', ' + fields[Q_SLOT_3].value;
  }
  if (fields[Q_SLOT_4].value !== '-') {
    text += ', ' + fields[Q_SLOT_4].value;
  }


  message.channel.send(text);
}

function sendCancelQMessage(message, embed, redStarLevel) {
  const { fields } = embed;

  let text = '';
  console.log('text1', text);
  hasPlayers = false;

  if (fields[Q_SLOT_2].value !== '-') {
    text += fields[Q_SLOT_2].value;
    hasPlayers = true;
  }
  if (fields[Q_SLOT_3].value !== '-') {
    text += ', ' + fields[Q_SLOT_3].value;
    hasPlayers = true;
  }
  if (fields[Q_SLOT_4].value !== '-') {
    text += ', ' + fields[Q_SLOT_4].value;
    hasPlayers = true;
  }

  if (hasPlayers) {
    text += ': ';
  }

  text += `${fields[Q_SLOT_1].value} a inchis cautarea pentru RS${redStarLevel}!`; 
  console.log('text', text);
  message.channel.send(text);
}

function sendRsReadyMessage(message, embed, redStarLevel) {
  const { fields } = embed;
  const text = `Tara, tara, avem ostasi! \n ${fields[Q_SLOT_1].value}, ${fields[Q_SLOT_2].value}, ${fields[Q_SLOT_3].value}, ${fields[Q_SLOT_4].value}, sunteti pregatiti sa incepem RS${redStarLevel} ?`; 
  message.channel.send(text);
}

function isRsQRdy(embed) {
  const { fields } = embed;
  if (fields[Q_SLOT_1].value !== '-' && fields[Q_SLOT_2].value !== '-' && fields[Q_SLOT_3].value !== '-' && fields[Q_SLOT_4].value !== '-') {
    return true;
  } else {
    return false;
  }
}

function addPlayerToQAdnReturnNewEmbed(message, currentEmbed, user) {
  let newEmbed = new Discord.MessageEmbed(currentEmbed);
  const username = `<@${user.id}>`;

  const { fields } = currentEmbed;
  if (fields[Q_SLOT_1].value === '-') {
    fields[Q_SLOT_1].value = username;
  } else if (fields[Q_SLOT_2].value === '-') {
    fields[Q_SLOT_2].value = username;
  } else if (fields[Q_SLOT_3].value === '-') {
    fields[Q_SLOT_3].value = username;
  } else if (fields[Q_SLOT_4].value === '-') {
    fields[Q_SLOT_4].value = username;
  }

  newEmbed.fields = fields;
  return newEmbed;
}

client.login(process.env.DISCORDJS_BOT_TOKEN);
