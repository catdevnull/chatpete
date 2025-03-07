// // TODO: Import LaTeX2Unicode implementation
// import { LaTeX2Unicode } from "./latex2unicode";

// thank the chinese
// https://github.com/yym68686/md2tgmd/blob/main/src/md2tgmd.py
// const l2u = new LaTeX2Unicode();

function findAllIndex(str: string, pattern: RegExp): number[] {
  const indexList: number[] = [0];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(str)) !== null) {
    if (match[1] !== undefined) {
      const start = match.index + match[0].indexOf(match[1]);
      const end = start + match[1].length;
      indexList.push(start, end);
    }
  }
  indexList.push(str.length);
  return indexList;
}

function replaceAll(
  text: string,
  pattern: RegExp,
  func: (match: string) => string
): string {
  const posList = findAllIndex(text, pattern);
  const strList: string[] = [];
  const originStr: string[] = [];

  for (let i = 1; i < posList.length - 1; i += 2) {
    const start = posList[i];
    const end = posList[i + 1];
    strList.push(func(text.slice(start, end)));
  }

  for (let i = 0; i < posList.length; i += 2) {
    const j = posList[i];
    const k = posList[i + 1];
    originStr.push(text.slice(j, k));
  }

  if (strList.length < originStr.length) {
    strList.push("");
  } else {
    originStr.push("");
  }

  const newList = originStr
    .map((item, index) => [item, strList[index] || ""])
    .flat();
  return newList.join("");
}

function escapeShape(text: string): string {
  return "▎*" + text.split(/\s+/).slice(1).join(" ") + "*\n\n";
}

function escapeMinus(text: string): string {
  return "\\" + text;
}

function escapeMinus2(text: string): string {
  return "@+>@";
}

function escapeBackquote(text: string): string {
  return "\\`\\`";
}

function escapeBackquoteInCode(text: string): string {
  return "@->@";
}

function escapePlus(text: string): string {
  return "\\" + text;
}

function escapeAllBackquote(text: string): string {
  return "\\" + text;
}

function dedentSpace(text: string): string {
  // Remove common leading whitespace from every line
  const lines = text.split("\n");
  const commonIndent = Math.min(
    ...lines
      .filter((line) => line.trim())
      .map((line) => line.match(/^\s*/)?.[0].length ?? Infinity)
  );
  const dedented = lines
    .map((line) => line.slice(commonIndent))
    .join("\n")
    .trim();
  return "\n\n" + dedented + "\n\n";
}

function splitCode(text: string): string {
  const splitList: string[] = [];

  if (text.length > 2300) {
    const splitStrList = text.split("\n\n");
    let conversationLen = splitStrList.length;
    let messageIndex = 1;

    while (messageIndex < conversationLen) {
      if (splitStrList[messageIndex].startsWith("    ")) {
        splitStrList[messageIndex - 1] += "\n\n" + splitStrList[messageIndex];
        splitStrList.splice(messageIndex, 1);
        conversationLen--;
      } else {
        messageIndex++;
      }
    }

    let splitIndex = 0;
    for (let index = 0; index < splitStrList.length; index++) {
      if (splitStrList.slice(0, index).join("").length < text.length / 2) {
        splitIndex++;
        continue;
      }
      break;
    }

    let str1 = splitStrList.slice(0, splitIndex).join("\n\n");
    if (!str1.trim().endsWith("```")) {
      str1 += "\n```";
    }
    splitList.push(str1);

    const codeType = text.split("\n")[0];
    let str2 = splitStrList.slice(splitIndex).join("\n\n");
    str2 = codeType + "\n" + str2;
    if (!str2.trim().endsWith("```")) {
      str2 += "\n```";
    }
    splitList.push(str2);
  } else {
    splitList.push(text);
  }

  return splitList.length > 1 ? splitList.join("\n@|@|@|@\n\n") : splitList[0];
}

function findLinesWithChar(s: string, char: string): string {
  const lines = s.split("\n");

  return lines
    .map((line) => {
      if (
        (line.replace(/```/g, "").split(char).length - 1) % 2 !== 0 ||
        (!line.trim().startsWith("```") &&
          (line.split(char).length - 1) % 2 !== 0)
      ) {
        return replaceAll(line, /\\`|(`)/g, escapeAllBackquote);
      }
      return line;
    })
    .join("\n");
}

function latex2unicode(text: string): string {
  text = text.trim();
  let blockmath = false;

  if (text.startsWith("\\[")) {
    blockmath = true;
  }

  text = text
    .replace(/\\\[/g, "")
    .replace(/\\\]/g, "")
    .replace(/\\\(/g, "")
    .replace(/\\\)/g, "");

  //   const result = l2u.convert(text);

  return blockmath ? "\n\n" + text.trim() + "\n\n" : text;
}

export function escape(
  text: string,
  flag: boolean = false,
  italic: boolean = true
): string {
  // Handle LaTeX expressions
  text = replaceAll(text, /(\\\(.*?\\\))/g, latex2unicode);
  text = replaceAll(text, /(\n*\s*\\\[[\D\d\s]+?\\\]\n*)/g, latex2unicode);

  // Replace LaTeX delimiters
  text = text
    .replace(/\\\[/g, "@->@")
    .replace(/\\\]/g, "@<-@")
    .replace(/\\\(/g, "@-->@")
    .replace(/\\\)/g, "@<--@");

  if (flag) {
    text = text.replace(/\\\\/g, "@@@");
  }

  text = text.replace(/\\`/g, "@<@").replace(/\\/g, "\\\\");

  if (flag) {
    text = text.replace(/@{3}/g, "\\\\");
  }

  // Handle italic text
  if (italic) {
    text = text
      .replace(/\_{1}(.*?)\_{1}/g, "@@@$1@@@")
      .replace(/_/g, "\\_")
      .replace(/@{3}(.*?)@{3}/g, "_$1_");
  } else {
    text = text.replace(/_/g, "\\_");
  }

  // Handle bold text and lists
  text = text
    .replace(/\*{2}(.*?)\*{2}/g, "@@@$1@@@")
    .replace(/\n{1,2}\*\s/g, "\n\n• ")
    .replace(/\*/g, "\\*")
    .replace(/@{3}(.*?)@{3}/g, "*$1*");

  // Handle links
  text = text
    .replace(/\!?\[(.*?)\]\((.*?)\)/g, "@@@$1@@@^^^$2^^^")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/@->@/g, "\\[")
    .replace(/@<-@/g, "\\]")
    .replace(/@-->@/g, "\\(")
    .replace(/@<--@/g, "\\)")
    .replace(/@{3}(.*?)@{3}\^{3}(.*?)\^{3}/g, "[$1]($2)");

  // Handle strikethrough
  text = text
    .replace(/\~{2}(.*?)\~{2}/g, "@@@$1@@@")
    .replace(/~/g, "\\~")
    .replace(/@{3}(.*?)@{3}/g, "~$1~");

  // Handle blockquotes
  text = text
    .replace(/\n>\s/g, "\n@@@ ")
    .replace(/>/g, "\\>")
    .replace(/@{3}/g, ">");

  // Handle headers and special characters
  text = replaceAll(text, /(^#+\s.+?\n+)|```[\D\d\s]+?```/g, escapeShape);
  text = text.replace(/#/g, "\\#");
  text = replaceAll(
    text,
    /(\+)|\n[\s]*-\s|```[\D\d\s]+?```|`[\D\d\s]*?`/g,
    escapePlus
  );

  // Handle numbered lists
  text = text.replace(/\n{1,2}(\s*\d{1,2}\.\s)/g, "\n\n$1");

  // Handle dashes and code blocks
  text = replaceAll(text, /```[\D\d\s]+?```|(-)/g, escapeMinus2);
  text = text.replace(/-/g, "@<+@").replace(/@\+>@/g, "-");

  text = text.replace(/\n{1,2}(\s*)-\s/g, "\n\n$1• ").replace(/@<\+@/g, "\\-");

  text = replaceAll(
    text,
    /(-)|\n[\s]*-\s|```[\D\d\s]+?```|`[\D\d\s]*?`/g,
    escapeMinus
  );
  text = text.replace(/```([\D\d\s]+?)```/g, "@@@$1@@@");

  // Handle backticks
  text = replaceAll(text, /@@@[\s\d\D]+?@@@|(`)/g, escapeBackquoteInCode);
  text = text
    .replace(/`/g, "\\`")
    .replace(/@<@/g, "\\`")
    .replace(/@->@/g, "`")
    .replace(/\s`\\`\s/g, " `\\\\` ");

  // Handle remaining special characters
  text = replaceAll(text, /(``)/g, escapeBackquote);
  text = text
    .replace(/@{3}([\D\d\s]+?)@{3}/g, "```$1```")
    .replace(/=/g, "\\=")
    .replace(/\|/g, "\\|")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\./g, "\\.")
    .replace(/!/g, "\\!");

  // Final processing
  text = findLinesWithChar(text, "`");
  text = replaceAll(text, /(\n+\x20*```[\D\d\s]+?```\n+)/g, dedentSpace);

  return text;
}
