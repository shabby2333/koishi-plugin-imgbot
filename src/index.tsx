import { Context, Plugin, Random, Schema } from 'koishi'
import { } from '@koishijs/assets'
import path from 'path'
import { fileURLToPath } from 'url'
import { mkdir, readdir, readFile, rename, stat } from 'fs/promises'

export const name = 'imgbot'
export const inject: Plugin['inject'] = ['assets']
export interface Config {
  baseDir: string
  dirs: Record<string, string>
  cds: Record<string, string>
  // saveImagePrefix: string
  // getImagePrefix: string
}

export const Config: Schema<Config> = Schema.object({
  baseDir: Schema.string().default('data/assets/imgbot/').description('基础路径'),
  dirs: Schema.dict(String).role('table')
    .description("分群文件数据存放位置: 键为群号,值为分群key 优先级为 设置特定分组 > 设置所有分组 > 默认存储到对应群号下 如需设置所有群对应路径 键为 'all' "),
  cds: Schema.dict(String).role('table').default({ 'all': '0' })
    .description("分群CD配置, 键为群号 或 分群key, 值为cd时间(s)，优先级为 群号 > 分群key > all > 默认(0)"),
  // saveImagePrefix: Schema.string().default('/').required()
  //   .description("存图指令"),
  // getImagePrefix: Schema.string().default('/').required()
  // .description("取图指令"),
})

const cdMap: Map<string, number> = new Map()

export function apply(ctx: Context) {
  ctx.on('message', async (session) => {
    if (!session.guildId) return
    const msg = session.elements[0]
    if (msg.type !== 'text' || !msg.attrs.content.startsWith('/')) return
    const dir = (msg.attrs.content as string).slice(1).trim()
    const images = session.elements.filter(e => e.type === 'img') as JSX.ResourceElement[]
    if (!dir) return
    if (images && images.length) {
      const dirName = await getGroupPath(session.guildId, dir)

      let fail = 0, all = 0
      await Promise.allSettled(images.map(async ({ attrs: img }) => {
        try {
          all++
          let tmpPath = await ctx.assets.upload(img.src, img.filename)
          tmpPath = fileURLToPath(tmpPath)
          const p = path.parse(tmpPath)
          const filename = `${p.name}.${p.ext}`
          await rename(tmpPath, path.join(dirName, filename))
        } catch (e) {
          fail++
        }
      }))

      await session.send(`共保存${all}张图片，保存成功${all - fail}张，失败${fail}张`)
    } else {
      const dirPath = await getGroupPath(session.guildId, dir)
      let imgPath: string | null = null;
      if ((await stat(dirPath)).isFile()) imgPath = dirPath
      else {
        const files = (await readdir(dirPath, { withFileTypes: true })).filter(e => e.isFile())
        const file = files[Random.int(files.length)]
        imgPath = path.join(file.parentPath, file.name)
      }
      if (!imgPath) return

      const img = 'data:image/png;base64,' + (await readFile(imgPath)).toString('base64')
      await session.send(<img src={img} />)
    }
  })

  ctx.command('imgbot/ls')
    .action(async ({ session }) => {
      const dirs = await readdir(await getGroupPath(session.guildId))
      return "dirs: " + dirs?.join(',')
    })
  // 命令解析 img bug，暂不可用
  // ctx.command('imgbot/save <dirName:string> <img:image>')
  //   .action(async ({ session }, dirName, img) => {
  //     const tmpPath = await ctx.assets.upload(img.src, img.file);
  //     renameSync(tmpPath.replace('file://', ''), getGroupPath(session.guildId, dirName, img.file))

  //     return "保存成功"
  //   })
  // ctx.command('imgbot/get <dirName>')
  //   .action(({ session }, dirName) => {
  //     if (!canGet(session.guildId)) return
  //     const dirPath = getGroupPath(session.guildId, dirName)
  //     let imgPath: string | null = null;
  //     if (statSync(dirPath).isFile()) imgPath = dirPath
  //     else {
  //       const files = readdirSync(dirPath, { withFileTypes: true }).filter(e => e.isFile())
  //       const file = files[Random.int(files.length)]
  //       imgPath = path.join(file.parentPath, file.name)
  //     }
  //     if (!imgPath) return

  //     const img = 'data:image/png;base64,' + readFileSync(imgPath).toString('base64')
  //     return <img src={img} />
  //   })

  async function getGroupPath(groupId: number | string, dirName?: string, fileName?: string) {
    const config = ctx.config as Config
    const baseDir = config.baseDir
    const basePath = path.resolve(baseDir)
    const groupDir = groupId in config.dirs
      ? `${config.dirs[groupId]}`
      : 'all' in config.dirs
        ? `${config.dirs['all']}`
        : `${groupId}`
    const groupPath = path.resolve(path.join(baseDir, groupDir))
    if (!groupPath.startsWith(basePath)) throw new Error('unsafe group path: ' + groupPath)
    if (!(await stat(groupPath)).isDirectory()) await mkdir(groupPath, { recursive: true })
    if (!dirName) return groupPath

    const dirPath = path.resolve(path.join(groupPath, dirName))
    if (!dirPath.startsWith(basePath)) throw new Error('unsafe dir path: ' + dirPath)
    if (!(await stat(dirPath)).isDirectory()) await mkdir(dirPath, { recursive: true })
    if (!fileName) return dirPath

    const imgPath = path.resolve(path.join(dirPath, fileName))
    if (!imgPath.startsWith(basePath)) throw new Error('unsafe image path: ' + imgPath)
    return imgPath
  }

  function canGet(groupID: string | number) {
    const config = ctx.config as Config
    const dataKey = config?.dirs?.[groupID] ?? config?.dirs?.['all'] ?? `${groupID}`
    const cd = config?.cds?.[groupID] ?? config?.cds?.[dataKey] ?? config?.cds?.['all'] ?? 0
    if (cd === 0 || typeof cd !== 'number') return true

    const lastPost = cdMap.has(`${groupID}`) ? cdMap.get(`${groupID}`) : 0
    const now = Date.now()
    const can = now - lastPost > cd * 1000
    if (can) cdMap.set(`${groupID}`, now)
    return can
  }
}

