'use strict';
// Фикстуры .idea/deployment.xml — формы настоящих файлов проектов пользователя (2026-09-28).

// beta: автозаливка, локальные и удалённые исключения, docs/visual; в конце файла перевода строки нет.
const BETA = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" autoUpload="Always" serverName="ftp" remoteFilesAllowedToDisappearOnAutoupload="false" autoUploadExternalChanges="true">
    <serverData>
      <paths name="ftp">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$" web="/" />
          </mappings>
          <excludedPaths>
            <excludedPath local="true" path="$PROJECT_DIR$/.idea" />
            <excludedPath path="/bitrix" />
            <excludedPath path="/upload" />
            <excludedPath local="true" path="$PROJECT_DIR$/.git" />
            <excludedPath local="true" path="$PROJECT_DIR$/.claude/scripts" />
            <excludedPath local="true" path="$PROJECT_DIR$/.claude/settings.local.json" />
            <excludedPath local="true" path="$PROJECT_DIR$/.claude/worktrees" />
            <excludedPath local="true" path="$PROJECT_DIR$/docs/visual" />
          </excludedPaths>
        </serverdata>
      </paths>
    </serverData>
    <option name="myAutoUpload" value="ALWAYS" />
  </component>
</project>`;

// gamma: .claude исключена целиком — добавлять нечего.
const GAMMA = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" autoUpload="Always" serverName="ftp" remoteFilesAllowedToDisappearOnAutoupload="false" confirmBeforeUploading="false" autoUploadExternalChanges="true">
    <option name="confirmBeforeUploading" value="false" />
    <serverData>
      <paths name="ftp">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$" web="/" />
          </mappings>
          <excludedPaths>
            <excludedPath local="true" path="$PROJECT_DIR$/.claude" />
            <excludedPath local="true" path="$PROJECT_DIR$/.idea" />
            <excludedPath local="true" path="$PROJECT_DIR$/.git" />
            <excludedPath local="true" path="$PROJECT_DIR$/.gitignore" />
            <excludedPath local="true" path="$PROJECT_DIR$/local/modules" />
          </excludedPaths>
        </serverdata>
      </paths>
    </serverData>
    <option name="myAutoUpload" value="ALWAYS" />
  </component>
</project>`;

// Theta: сервер сопоставлен с подпапкой dist — его не трогаем.
const DIST = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" serverName="ftp" remoteFilesAllowedToDisappearOnAutoupload="false" confirmBeforeUploading="false" autoUploadExternalChanges="true">
    <option name="confirmBeforeUploading" value="false" />
    <serverData>
      <paths name="ftp">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$/dist" web="/" />
          </mappings>
        </serverdata>
      </paths>
    </serverData>
  </component>
</project>`;

// alpha и многие другие: сервер без блока excludedPaths; «On explicit save action».
const NO_BLOCK = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" autoUpload="On explicit save action" serverName="ftp" remoteFilesAllowedToDisappearOnAutoupload="false" autoUploadExternalChanges="true">
    <serverData>
      <paths name="ftp">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$" web="/" />
          </mappings>
        </serverdata>
      </paths>
    </serverData>
  </component>
</project>
`;

// Два сервера с корнем проекта (прод и дев), у дева пустой <excludedPaths />; третий — подпапка.
const TWO = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" autoUpload="Always" serverName="dev" autoUploadExternalChanges="true">
    <serverData>
      <paths name="prod">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$" web="/" />
          </mappings>
          <excludedPaths>
            <excludedPath local="true" path="$PROJECT_DIR$/.idea" />
          </excludedPaths>
        </serverdata>
      </paths>
      <paths name="dev">
        <serverdata>
          <mappings>
            <mapping deploy="/www" local="$PROJECT_DIR$/" web="/" />
          </mappings>
          <excludedPaths />
        </serverdata>
      </paths>
      <paths name="static">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$/dist" web="/" />
          </mappings>
        </serverdata>
      </paths>
    </serverData>
    <option name="myAutoUpload" value="ALWAYS" />
  </component>
</project>
`;

// Обрезанный файл: у сервера нет </paths>.
const BROKEN = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" serverName="ftp">
    <serverData>
      <paths name="ftp">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$" web="/" />
          </mappings>
`;

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');

module.exports = { BETA, GAMMA, DIST, NO_BLOCK, TWO, BROKEN, crlf };
