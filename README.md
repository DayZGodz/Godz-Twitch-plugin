# 🎵 Spotify Controller — StreamDock Plugin

Plugin completo para controlar o Spotify pelo **Rise Mode Vision Sound 01 StreamDock** (ou compatíveis).  
16 ações, interface dark estilo Spotify, autenticação OAuth 2.0 via navegador externo.

---

## 📋 Índice

- [Ações Disponíveis](#-ações-disponíveis)
- [Instalação](#-instalação)
- [Registro no StoreCache.json](#-registro-no-storecachejson)
- [Autenticação (Primeira Vez)](#-autenticação-primeira-vez)
- [Configuração das Ações](#-configuração-das-ações)
- [Estrutura de Arquivos](#-estrutura-de-arquivos)
- [Troubleshooting](#-troubleshooting)
- [Detalhes Técnicos](#-detalhes-técnicos)
- [Changelog](#-changelog)

---

## 🎵 Ações Disponíveis

O plugin possui **16 ações** divididas em 5 categorias:

### Reprodução
| Ação | Descrição | Tipo |
|------|-----------|------|
| **Reproduzir/Pausar** | Alterna entre play e pause. Suporta Knob (girar = anterior/próximo) | Botão + Knob |
| **Próximo** | Pula para a próxima faixa | Botão |
| **Anterior** | Volta para a faixa anterior | Botão |
| **Reproduzir por URI** | Reproduz uma faixa ou álbum específico por URI do Spotify | Botão |

### Playlists
| Ação | Descrição | Tipo |
|------|-----------|------|
| **Reproduzir Playlist** | Inicia uma playlist selecionada | Botão |
| **Adicionar à Playlist** | Adiciona a música atual a uma playlist | Botão |
| **Remover da Playlist** | Remove a música atual de uma playlist | Botão |

### Volume
| Ação | Descrição | Tipo |
|------|-----------|------|
| **Aumentar Volume** | Aumenta o volume pelo passo configurado | Botão |
| **Diminuir Volume** | Diminui o volume pelo passo configurado | Botão |
| **Definir Volume** | Define um volume específico (0–100%) | Botão |
| **Controle de Volume** | Girar = ajustar volume, pressionar = mute/unmute. Passo configurável | Botão + Knob |

### Informações
| Ação | Descrição | Tipo |
|------|-----------|------|
| **Info da Música** | Exibe informações da faixa atual no botão | Botão |
| **Adicionar aos Favoritos** | Adiciona/remove a música dos favoritos (like/unlike) | Botão |

### Dispositivos e Modos
| Ação | Descrição | Tipo |
|------|-----------|------|
| **Mudar Dispositivo** | Alterna o dispositivo de reprodução do Spotify | Botão |
| **Modo de Repetição** | Alterna entre: desligado → repetir playlist → repetir faixa | Botão |
| **Modo Aleatório** | Ativa/desativa o modo shuffle | Botão |

---

## 🚀 Instalação

### Pré-requisitos

- **Rise Mode Vision Sound 01** (ou StreamDock compatível)
- **Rise Mode Controller** instalado
- **Spotify Desktop** instalado e com sessão ativa
- **Conta Spotify** (Premium recomendado para controle total)

### Passo a Passo

**1. Copie a pasta do plugin para o diretório de plugins:**

```
%APPDATA%\HotSpot\StreamDock\plugins\
```

O caminho completo fica:

```
C:\Users\SEU_USUARIO\AppData\Roaming\HotSpot\StreamDock\plugins\com.godz.Spotify.sdPlugin\
```

> **Dica:** Pressione `Win + R`, cole `%APPDATA%\HotSpot\StreamDock\plugins` e pressione Enter para abrir a pasta.

**2. Verifique que a estrutura ficou assim:**

```
plugins\
  com.godz.Spotify.sdPlugin\
    manifest.json
    package.json
    plugin\
      index.js
    propertyInspector\
      ...
    static\
      btn\
      icon\
```

**3. Registre o plugin no StoreCache.json** (veja seção abaixo)

**4. Reinicie o Rise Mode Controller**

**5. Procure por "Spotify"** na lista de ações e arraste para um botão

---

## 🗂️ Registro no StoreCache.json

O StreamDock precisa saber que o plugin existe. Para isso, adicione uma entrada no arquivo `StoreCache.json`.

### Localização do arquivo

```
%APPDATA%\HotSpot\StreamDock\storecache\StoreCache.json
```

Caminho completo:

```
C:\Users\SEU_USUARIO\AppData\Roaming\HotSpot\StreamDock\storecache\StoreCache.json
```

### Como editar

**1.** Feche o Rise Mode Controller completamente.

**2.** Abra o `StoreCache.json` em um editor de texto (Notepad, VS Code, etc.)

**3.** Localize o array `"plugins"` e adicione esta entrada:

```json
{
    "device": [
        "ControllerDeviceS2"
    ],
    "fileName": "com.godz.Spotify.sdPlugin",
    "localFile": "C:\\Users\\SEU_USUARIO\\AppData\\Roaming\\HotSpot\\StreamDock\\plugins\\com.godz.Spotify.sdPlugin",
    "serverFile": "",
    "title": "Spotify"
}
```

> **IMPORTANTE:** Substitua `SEU_USUARIO` pelo seu nome de usuário do Windows.

**4.** O resultado final deve ficar assim (exemplo com outros plugins):

```json
{
    "icons": [ ... ],
    "plugins": [
        {
            "device": ["ControllerDeviceS2"],
            "fileName": "tv.twitch.studio.sdPlugin",
            "localFile": "C:\\Users\\SEU_USUARIO\\...\\tv.twitch.studio.sdPlugin",
            "serverFile": "...",
            "title": "Twitch Studio"
        },
        {
            "device": ["ControllerDeviceS2"],
            "fileName": "com.godz.Spotify.sdPlugin",
            "localFile": "C:\\Users\\SEU_USUARIO\\AppData\\Roaming\\HotSpot\\StreamDock\\plugins\\com.godz.Spotify.sdPlugin",
            "serverFile": "",
            "title": "Spotify"
        }
    ]
}
```

**5.** Salve o arquivo e abra o Rise Mode Controller.

### Valores do campo `device`

| Dispositivo | Valor |
|-------------|-------|
| Rise Mode Vision Sound 01 | `ControllerDeviceS2` |
| Outros StreamDock (verificar) | `ControllerDeviceVision01` ou similar |

> Se usar outro modelo de StreamDock, verifique o valor correto olhando as entradas já existentes no `StoreCache.json`.

---

## 🔐 Autenticação (Primeira Vez)

O login é feito **100% pelo navegador externo** (fora do Rise Mode Controller), via OAuth 2.0 do Spotify.

### Passo a Passo

1. Arraste qualquer ação "Spotify" para um botão
2. No painel de configuração à direita, clique **"Fazer Login com Spotify"**
3. Um **navegador externo** abre com a página de login do Spotify
4. Faça login com email e senha
5. Autorize as permissões solicitadas
6. O navegador redireciona de volta — o painel mostra **"✅ Autenticado como [Seu Nome]"**
7. Selecione o **dispositivo de reprodução** no dropdown
8. Pronto! O botão já funciona

### Próximas Vezes

- O token é salvo automaticamente em `%APPDATA%\stream-deck-spotify-plugin.json`
- O refresh token renova o acesso sem precisar fazer login de novo
- Se precisar refazer login, clique "Fazer Logout" e depois "Fazer Login"

### Permissões Solicitadas (Scopes)

| Permissão | Para quê |
|-----------|----------|
| `user-read-private` | Identificar o usuário |
| `user-read-email` | Exibir email no perfil |
| `user-modify-playback-state` | Play, pause, skip, volume |
| `user-read-playback-state` | Ler estado atual (música, volume) |
| `user-read-currently-playing` | Exibir info da música atual |
| `playlist-read-private` | Listar playlists privadas |
| `playlist-read-collaborative` | Listar playlists colaborativas |
| `playlist-modify-public` | Adicionar/remover de playlists públicas |
| `playlist-modify-private` | Adicionar/remover de playlists privadas |

---

## ⚙️ Configuração das Ações

Todas as ações possuem um painel de configuração (Property Inspector) com:
- Botão de login/logout
- Seletor de dispositivo de reprodução
- Configurações específicas da ação

### Reproduzir/Pausar
- Alterna entre play e pause
- **Como Knob:** girar para esquerda = anterior, girar para direita = próximo

### Próximo / Anterior
- Pula ou volta uma faixa

### Reproduzir Playlist
- Selecione uma playlist no painel de configuração
- O botão inicia a reprodução dessa playlist

### Adicionar à Playlist / Remover da Playlist
- Selecione a playlist destino no painel
- Ao pressionar, adiciona ou remove a música que está tocando

### Aumentar / Diminuir Volume
- Passo configurável (padrão: 10%)

### Definir Volume
- Define um volume fixo (0–100%)

### Controle de Volume (Knob)
- **Girar:** ajusta o volume pelo passo configurado (1–100)
- **Pressionar:** mute/unmute (silencia e restaura volume anterior)
- Configure o passo no painel de configuração

### Info da Música
- Exibe nome da faixa e artista no botão

### Favoritos (Like/Unlike)
- Adiciona ou remove a música atual dos favoritos

### Modo de Repetição
- Alterna entre: desligado → repetir playlist → repetir faixa

### Modo Aleatório
- Ativa/desativa shuffle

### Mudar Dispositivo
- Transfere a reprodução para outro dispositivo

### Reproduzir por URI
- Configure um URI do Spotify (ex: `spotify:track:xxx`) no painel
- Ao pressionar, reproduz esse conteúdo

---

## 📦 Estrutura de Arquivos

```
com.godz.Spotify.sdPlugin/
├── manifest.json                    # Definição do plugin e das 16 ações
├── package.json
├── README.md
├── plugin/
│   └── index.js                     # Backend (Node.js) — toda a lógica
├── propertyInspector/
│   ├── utils/
│   │   ├── common.js                # Comunicação WebSocket + utilidades
│   │   ├── spotify-theme.css        # Tema dark estilo Spotify
│   │   ├── auth-manager.js          # Gerenciador de autenticação
│   │   ├── login-button.js          # Componente de login/logout
│   │   └── authorization.html       # Página de callback OAuth
│   ├── playpause/
│   │   ├── index.html
│   │   └── index.js
│   ├── next/
│   ├── previous/
│   ├── volumeup/
│   ├── volumedown/
│   ├── volumecontrol/               # Usado por "Definir Volume" e "Controle de Volume (Knob)"
│   ├── playplaylist/
│   ├── addtoplaylist/
│   ├── removeplaylistsong/
│   ├── songinfo/
│   ├── changedevice/
│   ├── likesong/
│   ├── playuri/
│   ├── repeat/
│   └── shuffle/
└── static/
    ├── btn/                         # Ícones 144x144 para os botões
    └── icon/                        # Ícones do plugin e das ações
```

---

## 🐛 Troubleshooting

### Navegador não abre ao clicar "Fazer Login"
- Verifique se o bloqueador de pop-ups não está impedindo
- Desabilite o bloqueador para `localhost` / `127.0.0.1`

### Nenhum dispositivo encontrado
- O Spotify Desktop precisa estar **aberto e com sessão ativa**
- Toque qualquer música no Spotify primeiro
- Clique "Atualizar Dispositivos" no painel

### Botão não faz nada
- Verifique se selecionou um dispositivo no dropdown
- Verifique se está autenticado (deve mostrar "✅ Autenticado")
- Confira o log de debug em: `%APPDATA%\spotify-plugin-debug.log`

### Token expirado
- O plugin renova o token automaticamente via refresh token
- Se não funcionar, clique "Fazer Logout" e depois "Fazer Login" novamente

### Plugin não aparece na lista de ações
- Verifique se a entrada existe no `StoreCache.json`
- Verifique se a pasta do plugin está em `%APPDATA%\HotSpot\StreamDock\plugins\`
- Reinicie o Rise Mode Controller

---

## � Detalhes Técnicos

### Comunicação

- **Backend (plugin/index.js):** Roda em Node.js 20 via Rise Mode Controller
- **Frontend (Property Inspectors):** Comunica com o backend via WebSocket
- **Spotify API:** Todas as chamadas passam pelo backend com rate limiting
- **Tokens:** Armazenados em `%APPDATA%\stream-deck-spotify-plugin.json`
- **Log de debug:** `%APPDATA%\spotify-plugin-debug.log`

### Endpoints Spotify utilizados

| Endpoint | Ação |
|----------|------|
| `PUT /me/player/play` | Play |
| `PUT /me/player/pause` | Pause |
| `POST /me/player/next` | Próximo |
| `POST /me/player/previous` | Anterior |
| `PUT /me/player/volume` | Volume |
| `PUT /me/player/repeat` | Repetição |
| `PUT /me/player/shuffle` | Aleatório |
| `PUT /me/player` | Mudar dispositivo |
| `GET /me/player` | Estado atual |
| `GET /me/player/currently-playing` | Música atual |
| `GET /me/playlists` | Listar playlists |
| `POST /playlists/{id}/items` | Adicionar à playlist |
| `DELETE /playlists/{id}/items` | Remover da playlist |
| `GET /me/player/devices` | Listar dispositivos |

---

## 🔄 Changelog

### v2.1.0 — Versão Atual
- 16 ações completas com todos os Property Inspectors
- Autenticação OAuth 2.0 via navegador externo
- Suporte a Knob (Reproduzir/Pausar e Controle de Volume)
- Passo de volume configurável (1–100)
- Mute/unmute via pressão do knob
- Arte do álbum exibida nos botões
- Rate limiting para proteger contra throttle da API
- Refresh token automático

### v2.0.0
- Interface dark estilo Spotify
- Backend Node.js com comunicação WebSocket
- Suporte inicial a Rise Mode Vision Sound 01

---

## 📝 Notas

- Requer **Spotify Premium** para controle total de reprodução (play, pause, skip, volume)
- Contas gratuitas podem ter limitações em controle remoto de dispositivos
- Latência típica: 200–500ms (depende da rede)
- O plugin **não** coleta dados pessoais — tudo roda localmente

---

## 📄 Licença

Este projeto é fornecido como está. Sinta-se livre para modificar e usar.

---

## 🛠️ Dicas Avançadas e Técnicas

- **Arquivo de Log:** Todas as operações do backend são registradas em `%APPDATA%\spotify-plugin-debug.log`. Consulte este arquivo para depuração de problemas ou falhas de autenticação.
- **Renovação Automática de Token:** O plugin tenta renovar o token de acesso automaticamente ao iniciar, usando o refresh token salvo. Isso reduz a necessidade de refazer login manualmente.
- **Armazenamento de Configurações:** As configurações de cada ação (volume, dispositivo, playlists, etc.) são salvas localmente e sincronizadas entre backend e Property Inspector via WebSocket.
- **Suporte a Multi-Actions:** Todas as ações do plugin podem ser usadas em Multi-Actions do StreamDock, permitindo automações avançadas.
- **Robustez e Fallbacks:** Em caso de erro de autenticação, o plugin limpa automaticamente o cache local e solicita novo login ao usuário.
- **Requisitos de Node.js:** O plugin requer Node.js 20 para funcionamento pleno (verifique a versão instalada no sistema).
- **Scripts de Desenvolvimento:** O arquivo `package.json` inclui um script de servidor simples (`npm run server`) para testes locais e desenvolvimento.
- **Licença MIT:** O projeto é open source sob licença MIT.

---

**Desenvolvido por Godz Development**
