function logger(zone, message) {
  console.log(`[${zone}] ${message}`);
}

function tipsMessage(message, textToSend, timeoutMinutes = 3, deleteUserMessage = false) {
  message.reply(textToSend).then((response) => {
    if (timeoutMinutes > 0) {
      // delete bot response
      response.delete({ timeout: 1000 * 60 * timeoutMinutes }).catch((err) => {
        logger('ERROR', `${message.author.username} | Can't delete tips message`);
        console.log(err);
      });

      // delete bot response
      if (deleteUserMessage) {
        message.delete({ timeout: 1000 * 60 * timeoutMinutes }).catch((err) => {
        logger('ERROR', `${message.author.username} | Can't delete user message (tips)`);
        console.log(err);
      });;
      }
    }
  }).catch((err) => {
    logger('ERROR', `${message.author.username} | Can't send reply message`);
    console.log(err);
  });
}

module.exports = { logger, tipsMessage };
