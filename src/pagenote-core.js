import {gotoPosition, highlightKeyword, getWebIcon, captureElementImage, showCamera} from './document'
import {decryptedData, encryptData, getParams, debounce} from "./utils";
import whatsPure from 'whats-element/pure'

import { BAR_STATUS } from "./const";
import {Step,Steps} from './pagenote-step';
import './widget/camera.scss'
// import './widget/pagnote-modal';
//whats getTarget try catch  同时计算出多个 进行长度比较 取最优的
//将所有常用量进行存储 此处是全局 避免和原本常亮冲突 放到 constant里面
const whats = new whatsPure();

//增加开关 是否开启
export default function PagenoteCore(id, options={},language){ // TODO 支持载入语言包
    this.id = id || "pagenote-container";
    this.options =  Object.assign({
        initType:'default',
        dura:100,
        saveInURL: false,
        saveInLocal: true,
        maxMarkNumber:50,
        blacklist:[],
        autoLight: false,
        colors:['rgba(114,208,255)','#ffbea9','#c8a6ff','#6fe2d5','rgba(255,222,93)','rgba(251, 181, 214)','rgba(0,0,0,0.5)'],
        shortCuts: 'M', // 对应colors的快捷键
        barInfo:{
            right:30,
            top:200,
            status: BAR_STATUS.fold,
        },
        onShare: null, // function
        functionColors:[],
        sideBarActions:[],
        categories:[],
    },options);
    this.status = this.CONSTANT.UN_INIT;
    this.recordedSteps = new Steps({
        max: this.options.maxMarkNumber,
    },this);
    this.snapshots = [];
    this.categories = new Set();
    this.note='';
    this.score=0; // 评分系统
    this.runindex = null;
    const runBarInfo = JSON.parse(JSON.stringify(this.options.barInfo));
    runBarInfo.status = runBarInfo.status || 'fold';
    this.runningSetting = Object.assign({},{
        initType: this.options.initType,
        dura: this.options.dura,
        autoLight: this.options.autoLight,
        barInfo: runBarInfo,
    });
    this.target = {}
    //用户用户复制的 分享的URL
    this.url = window.location.href
    //只提供读方法
    this.data = "" //PagenoteCore 使用的原始数据字符串
    this.plainData = {} // 与 data 配套，明文的存储数据
    this.blackNodes = []
    this.lastaction = this.CONSTANT.DIS_LIGHT
    let status,
        nextTimer,
        runningTimer

    let modal = null;// pagenote 弹框，避免重复出现

    // 全局变量
    const CALLBACKFUN = [],
          NULL = null,
          constant = this.CONSTANT,
          OPTIONS = this.options,
          // 网站配置的setting设置
          location = window.location,
          emptyString = "",
          isMoble = "ontouchstart" in window,
          blackNodes = this.blackNodes;


    function handleUp(e){
        const selection = document.getSelection();
        const selectedText = selection.toString().trim(); // 跨标签高亮
        // pagenote 状态监测
        const isWaiting = this.status === constant.WAITING && selectedText === this.target.text;
        const isDestroy = this.status === this.CONSTANT.DESTROY;
        if(isWaiting || isDestroy || selection.rangeCount===0){ // 避免重复计算\无选区
            return;
        }
        // 选区父节点是否存在监测
        const range0 = selection.getRangeAt(0);
        const parentElement = selection.anchorNode?range0.commonAncestorContainer.parentNode:null;
        const noParentElement = !parentElement || !parentElement.tagName;
        if(noParentElement){
            return;
        }
        // 黑名单节点监测
        let isBlackNode = parentElement.tagName.toLowerCase().indexOf('pagenote')>-1;
        for(let i of blackNodes){
            if(i.contains(parentElement)||i.contains(selection.anchorNode)||i.contains(selection.focusNode)){
                isBlackNode = false;
                break;
            }
        }
        if(isBlackNode){
            return;
        }


        // 是否可编辑区
        let canHighlight = true;
        if(!parentElement || parentElement.contentEditable==='true'){
            canHighlight = false;
        }

        // TODO 监测是否有图片、视频等其他资源
        const selectedElementContent = range0.cloneContents();

        if(selectedText){
            let before = range0.startContainer.textContent.substr(0,range0.startOffset);
            let after = range0.endContainer.textContent.substr(range0.endOffset,10);
            if(!before){
                before = parentElement.previousSibling?parentElement.previousSibling.textContent:'';
            }
            if(!after){
                after = parentElement.nextSibling?parentElement.nextSibling.textContent:''
            }

            const selectionRects=selection.getRangeAt(0).getClientRects();
            const lastSelectionRect=selectionRects[selectionRects.length-1];
            if(!lastSelectionRect){
                return;
            }
            const x = isMoble ? lastSelectionRect.x + lastSelectionRect.width/2
                :Math.min(lastSelectionRect.x+lastSelectionRect.width/1.5+16,window.innerWidth-150);
            const y = window.scrollY+lastSelectionRect.y+(isMoble?lastSelectionRect.height:lastSelectionRect.height)

            const whatsEl = whats.getUniqueId(parentElement);
            const cursorX = parseInt(x);
            const cursorY = parseInt(y);
            this.target = {
                x:cursorX,
                y:cursorY,
                pre:before,
                suffix:after,
                text:selectedText,
                tip:'', // 提供支持纯文本的取值方式
                time: new Date().getTime(),
                id: whatsEl.wid,
                isActive: false,
                bg:this.options.colors[0],
                offsetX: 0.5, // right 小于1时 为比例
                offsetY: 0.99, // bottom
                parentW: parseInt(parentElement.clientWidth),
                clientX: e.clientX,
                clientY: e.clientY,
                canHighlight: canHighlight,
                selectionElements: selectedElementContent,
            };

            this.status = (this.status === constant.REPLAYING || this.status === constant.PLAYANDWAIT) ? constant.PLAYANDWAIT : constant.WAITING
        }else{
            this.target = {}
            this.status = constant.PAUSE
        }
    }
    let hasListened = false;
    // TODO 初始化动效
    this.init = function(initData,sync=false){ // 为一段加密过的数据信息
        initData = initData||getParams().paramObj[constant.ID];
        if(!initData && this.options.saveInLocal){
            initData = localStorage.getItem(this.id)
        }
        let simpleStep = [];
        let setting = {};
        let dataVersion = 1;
        if(initData){
            try {
                let dataObject = {};
                if(typeof initData === 'object' && initData.steps){
                    dataObject = initData;
                    simpleStep = initData.steps || [];
                    setting = initData.setting || {};
                }
                else if(typeof initData === 'string'){
                    dataObject = decryptedData(initData);
                    simpleStep = dataObject.steps || [];
                    setting = dataObject.setting || {};
                }
                this.snapshots = Array.isArray(dataObject.snapshots) ? dataObject.snapshots : [];
                this.categories = new Set(dataObject.categories||[dataObject.category]);
                this.note = dataObject.note;
                dataVersion = dataObject.version || 1;
            }catch (e) {
                console.error('解析step异常',e,initData);
            }
        }
        this.recordedSteps.splice(0,this.recordedSteps.length);
        if(dataVersion===2){
            simpleStep.forEach((step)=>{
                const newStep = new Step(step,this);
                this.recordedSteps.add(newStep);
            });
        }else{
            simpleStep.forEach((step)=>{
                const stepTemp = {};
                this.CONSTANT.STORE_KEYS_VERSION_1.forEach((item,index)=>{
                    stepTemp[item] = step[index];
                });
                const newStep = new Step(stepTemp,this);
                this.recordedSteps.add(newStep);
            });
        }
        // 修改当前设置项
        this.runningSetting = Object.assign(this.runningSetting,setting);

        // 黑名单初始化
        setTimeout(()=>{
            [...OPTIONS.blacklist,'.no-pagenote','*[data-pagenote]','*[contenteditable="true"]'].forEach((queryId)=>{
                [].forEach.call(document.querySelectorAll(queryId),(blockElement)=>{
                    blackNodes.push(blockElement)
                });
            })
        },0); // timeout 方式元素还未渲染出来

        [].forEach.call(document.querySelectorAll('light[data-highlight]'),function (element) {
            element.outerHTML = element.innerHTML;
        });

        switch (this.runningSetting.initType) {
            case 'light':
                this.replay(0,false,true,true,true);
                break;
            case 'default':
                this.replay(0,false,true,true,function (step) {
                    return step.isActive;
                });
                break;
            case 'off':
                // this.recordedSteps.forEach((tempStep)=>{
                //     tempStep.isActive = false;
                // });
                break;
        }
        // 销毁 pagenote ，删除所有监听
        if(!hasListened){
            upListen.call(this);
            hasListened = true;
            function upListen() {
                let levent = null;
                const upEvent = isMoble?'touchstart':'mouseup';
                document.addEventListener(upEvent,(e)=>{
                    // 先执行click再执行mouseup，防止mouseup 将选区清空
                    setTimeout(()=>{
                        levent = e;
                        handleUp.call(this,e)
                    },1)
                },{capture:true});
                document.onselectionchange = debounce((e)=>{
                    if(levent && levent.target && levent.target.id!=="record"){
                        handleUp.call(this,e)
                    }
                },400);
            }

            const shortCutActions = {};
            const eventIDActions = {};
            const hoverIDActions = {};
            const dbClickActions = {};
            this.options.functionColors.forEach((actionGroup,groupIndex)=>{
                actionGroup.forEach((action,itemIndex)=>{
                    action.eventid = groupIndex + itemIndex + Math.random();
                    if(action.shortcut){
                        shortCutActions[action.shortcut] = action.onclick;
                    }
                    eventIDActions[action.eventid] = action.onclick;
                    hoverIDActions[action.eventid] = action.onmouseover;
                    dbClickActions[action.eventid] = action.ondbclick;
                });
            });

            // 监听单独提取为一个文件
            document.addEventListener('keyup',(e)=>{
                if(this.status===constant.WAITING){
                    if(this.target.canHighlight===true){
                        const colorIndex = this.options.shortCuts.toLowerCase().indexOf(e.key);
                        const colors = this.options.colors;
                        if(colorIndex>-1 && colors[colorIndex]){
                            this.record({
                                bg: colors[colorIndex]
                            },true);
                        }else if(typeof shortCutActions[e.key] === 'function'){
                           shortCutActions[e.key](e,this.target);
                        }
                    }
                }
            },{capture:true});

            document.addEventListener('dblclick',(e)=>{
                let eventid = e.target.dataset.eventid;
                if(eventid && dbClickActions[eventid]){
                    dbClickActions[eventid](e,this.target);
                }
            });

            document.addEventListener('click',(e)=>{
                const tagName = (e.target.tagName || '').toLowerCase();
                switch (tagName) {
                    case 'pagenote-action-button':
                        let eventid = e.target.dataset.eventid;
                        if(eventid && typeof eventIDActions[eventid]==='function'){
                            eventIDActions[eventid](e,this.target);
                        }
                        break;
                    case 'pagenote-color-button':
                        const color = e.target.dataset.color;
                        this.record({
                            bg:color,
                        });
                        break;
                    default:
                        const hiColor = e.target.dataset ? e.target.dataset.pagenotecolor : '';
                        if(color){
                            this.record({
                                bg:hiColor,
                            });
                        }
                }
            },{capture: true});

            document.documentElement.addEventListener('mouseover',(e)=>{
                const tagName = (e.target.tagName || '').toLowerCase();
                if(tagName==='pagenote-action-button'){
                    let eventid = e.target.dataset.eventid;
                    if(hoverIDActions[eventid]){
                        hoverIDActions[eventid](e,this.target);
                    }
                }
            },{capture:true});

            // url listen start
            window.addEventListener('hashchange', ()=> {
                this.status = constant.HASHCHANGED;
            },{capture:true});
            window.addEventListener('popstate', ()=> {
                this.status = constant.URLCHANGED;
            },{capture:true});

            const originPush = window.history.pushState;
            window.history.pushState = ()=>{
                originPush.apply(this,arguments);
                this.status = constant.URLCHANGED;
            };
            const originReplace = window.history.replaceState;
            window.history.replaceState = ()=>{
                originReplace.apply(this,arguments);
                this.status = constant.URLCHANGED;
            };
            /*url change end*/
        }
        this.status = constant.READY;

        if(sync){
            this.makelink();
        }
    };

    this.destroy = function () {
        this.status = constant.DESTROY;
        document.querySelectorAll('light[data-highlight]').forEach((element)=>{
            element.outerHTML = element.innerText;
        })
    };

    this.realive = function () {
        this.status = constant.RE_ALIVE;
        this.replay(0,false,true,true,function (step) {
            return step.isActive;
        });
    };

    this.toggleAllLight = function () {
        const lightAll = this.lastaction===this.CONSTANT.DIS_LIGHT;
        this.replay(0,false,true,true,lightAll);
        if(lightAll===false){
            this.runningSetting.autoLight = false;
        }
        // this.makelink(callback);
    };

    this.addListener = function(fun){
        if(typeof fun == "function"){
            CALLBACKFUN.push(fun)
        }
    };

    // success: true,faild:false 增加参数 排序方式，按时间、按网页位置（默认)
    this.record = function(info={},forceRecord){
        info = Object.assign(this.target,info);
        const maxNn = OPTIONS.maxMarkNumber;
        if(this.recordedSteps.length>=maxNn){
            alert("标记失败！最大标记数量为 "+maxNn);
            return false
        }
        // 如果当前状态不为等待记录 且不是强行记录时
        if(!forceRecord && this.status!==constant.WAITING){
            return false;
        }
        this.status = constant.RECORDING;

        const newStep = new Step(info,this);
        // TODO target 存储在 info 中 避免再次寻找
        const target = whats.getTarget(info.id);
        // captureElementImage(target).then((imageSrc)=>{
        //     newStep.thumbnail = imageSrc;
        //     newStep.save();
        // });
        this.recordedSteps.add(newStep);
        this.recordedSteps = this.recordedSteps.sort((a,b)=>{
            return a.y -b.y
        });
        window.getSelection().removeAllRanges();
        this.target = {};

        this._highlight(target,true,newStep,true,this);
        this.makelink((result)=>{
            if(!result){
                alert('保存失败');
                this.recordedSteps.splice(-1,1);
                console.error('记录失败');
                this.status = constant.RECORDFAIL;
                return false
            }
            this.status = constant.RECORDED
        });
        return newStep
    };

    this._highlight = function (targetEl,isLight,runStep,isActiveLight,that,callback) {
        highlightKeyword(runStep.id,targetEl,runStep.text,isLight,runStep.bg,that.blackNodes, (result)=> {
            if(result.id){
                const highlightElements = targetEl.querySelectorAll(`light[data-highlight='${result.id}']`);
                runStep.relatedNode = highlightElements;
                [].forEach.call(highlightElements,(item,index)=>{
                    item.dataset.active = isActiveLight ? '1' : '0';
                    item._light = runStep;
                    if(runStep.tip && index===highlightElements.length-1){
                        item.dataset['note'] = '1'
                    }
                    // render(<StepTag pagenote={that} isActive={isActiveLight} lightId={result.id} step={runStep} />,item);
                });
            }
            runStep.isActive = isActiveLight;
            runStep.warn = result.totalMatches ? '' : '未找到匹配内容';
            typeof callback === 'function' && callback();
        });
    };

    this.remove = function(stepIndex=-1,id){
        //删除所有
        if(stepIndex===-1){
            while(this.recordedSteps.length>0){
                this.replay(0,false,false)
                this.recordedSteps.splice(0,1)
            }
            this.status = constant.PAUSE
            this.status = constant.REMOVEDALL;
        }else {
            this.replay(stepIndex,false,false)
            this.recordedSteps.splice(stepIndex,1)
            this.status = constant.REMOVED;
        }
        this.makelink()
    };

    // index 入参修改为array 支持断点点亮
    this.replay = function(index=0,goto=true,lightCheck=true,autoNext=false,isActive=true){
        const timeout=this.runningSetting.dura;
        //TODO 根据当前窗口与记录时候窗口大小进行比较，如果差异较大 则进行提示 可能定位不准确的情况
        const runStep = this.recordedSteps[index];
        if(!runStep){
            this.runindex = NULL
            this.status = constant.DONE
            this.makelink();
            return
        }
        const isLight = typeof lightCheck == "function" ? lightCheck(runStep) : lightCheck;
        const isActiveLight = typeof isActive == "function" ? isActive(runStep) : isActive;
        const {x,y,id,text} = runStep;


        clearInterval(runningTimer)
        clearTimeout(nextTimer)
        runningTimer = nextTimer = NULL
        //开始滚动
        this.runindex = index
        this.status = constant.REPLAYING
        this.lastaction = isActiveLight ? constant.LIGHT : constant.DIS_LIGHT;
        runStep.isActive = isActiveLight;

        let targetEl = id ? whats.getTarget(id) : NULL;
        const that = this;
        let findTimer = null;
        (function findElement(retryTimes) {
            targetEl = id ? whats.getTarget(id) : NULL;
            clearTimeout(findTimer);
            if((!targetEl && retryTimes>0) || !text){
                findTimer = setTimeout(()=>{
                    console.log(retryTimes,'重试');
                    findElement(retryTimes-1);
                },3000);
                return;
            }
            that._highlight(targetEl,isLight,runStep,isActiveLight,that)
        })(5);

        // 如果没有next了 则保存数据
        if(!autoNext){
            this.makelink();
        }

        if(goto){
            runningTimer = gotoPosition(document.querySelector(`light[data-highlight='${runStep.lightId}']`)||targetEl,x-window.innerWidth/2,y-window.innerHeight/3,()=>{
                this.runindex = NULL
                if(autoNext){
                    nextTimer = setTimeout(()=>this.replay(index+1,goto,lightCheck
                        ,autoNext,isActive),timeout)
                }else{
                    this.status = constant.DONE
                    clearTimeout(nextTimer)
                }
            })
        }else if(autoNext){
            nextTimer = setTimeout(()=>this.replay(index+1,goto,lightCheck
                ,autoNext,isActive),timeout)
        }
        else{
            this.runindex = NULL
            this.status = constant.DONE
        }
        this.makelink();
    };

    //success no return; failed return errorMsg 持久化存储
    this.makelink = (callback) => {
        this.status = constant.START_SYNC;
        store(typeof callback === 'function' ? callback : function () {
        });
    };

    this.openModal = (activeTab='md')=>{

        if(modal&&modal.show){
            modal.changeTab(activeTab);
            modal.initData();
        } else {
            modal = document.createElement('pagenote-modal');
            modal.setAttribute('show',true);
            modal.setAttribute('activeTab',activeTab);
            document.body.appendChild(modal);
        }
    };

    this._syncModal = ()=>{
        if(modal){
            modal.initData();
        }
    };

    this.generateMD = ()=>{
        let content = '';
        const steps = this.recordedSteps;
        const url = window.location.href;

        const titleEle = document.querySelector('title');
        const title = titleEle.innerText.trim() || '';

        content += `## [${title}](${url})\n\n`;

        steps.forEach((step)=>{
            const refer = step.text;
            const note = step.tip;
            if(note!==refer&&note){
                content += `${note}\n`;
            }
            content += `> ${refer}\n\n`; // [${time}](${recordInfo})
        });
        content += '\n';
        content = content.trim();
        return content;
    };

    this.notification = (message,type,duration = 3000, position={x:"50%",y:"50%"})=>{
       const ele =  document.createElement('pagenote-notification');
       ele.className = type || 'success';
       ele.innerHTML = message;
       ele.style.left = position.x || this.target.clientX || window.innerWidth/2 + 'px';
       ele.style.top = position.y || this.target.clientY || window.innerHeight/2 + 'px';
       document.body.appendChild(ele);
       let timer = null;
       setTimer();
       ele.addEventListener('mouseover',function () {
           ele.classList.remove('fade');
           clearTimeout(timer);
       },{capture:true});
       ele.addEventListener('mouseout',function () {
           setTimer();
       },{capture:true});

        function setTimer() {
            ele.classList.add('fade');
            timer = setTimeout(()=>{
                ele.remove();
            },duration);
        }
    };

    this.capture = (target=document.documentElement || document.body)=>{
        return new Promise((resolve,reject)=>{
            captureElementImage(target).then((imageSrc)=>{
                this.snapshots.push(imageSrc);
                this.makelink();
                showCamera(imageSrc);
                resolve(imageSrc);
            }).catch((e)=>{
                console.error(e);
                reject(e);
                this.notification('拍照失败啦','error')
            });
        })
    };

    const store= debounce( (callback)=> {
        try{
            const simpleSteps = [];
            this.recordedSteps.forEach((step)=>{
                const tempStep = {};
                Object.keys(step).forEach((key)=>{
                    if(this.CONSTANT.STORE_KEYS_VERSION_2_VALIDATE.includes(key)){
                        tempStep[key] = step[key];
                    }
                });
                simpleSteps.push(tempStep);
            });

            const differentSetting = {};
            let diffSettingCount = 0;
            Object.keys(this.runningSetting).forEach((key)=>{
                if(this.runningSetting[key]!==OPTIONS[key]){
                    differentSetting[key] = this.runningSetting[key];
                    diffSettingCount++
                }
            });

            const images = document.getElementsByTagName('img');
            const storeImages = [];
            for(let i=0; i<images.length; i++) {
                const tempImg = images[i];
                const {width,height,src} = tempImg;
                if(src && width>100 && height>100 && width/height<2 && height/width<2) {
                    storeImages.push(src);
                }
            }

            const titleEle = document.querySelector('title');
            const descriptionEle = document.querySelector('meta[name=description]');
            const storeInfo={
                steps:simpleSteps,
                setting:{},
                url: window.location.href,
                lastModified:new Date().getTime(),
                icon:getWebIcon(),
                title: titleEle? titleEle.innerText.trim() :'',
                description: descriptionEle? descriptionEle.content : '',
                images: storeImages,
                snapshots: this.snapshots,
                version: 2,
                categories: this.categories.size>0?Array.from(this.categories):[],
                note: this.note,
            };
            if(diffSettingCount){
                storeInfo.setting = differentSetting;
            }else{
                delete storeInfo.setting
            }

            // TODO 不再将数据存储在URL中，通过shareKey存储
            const {paramObj,paramKeys} = getParams();
            if(!paramKeys.includes(constant.ID)){
                paramKeys.push(constant.ID)
            }
            paramObj[constant.ID]=simpleSteps.length?encryptData(storeInfo):'';
            this.data = paramObj[constant.ID];
            this.plainData = storeInfo;
            // json parse 避免存储一些异常数据 如 function
            const storeData = simpleSteps.length?JSON.parse(JSON.stringify(storeInfo)):{};
            if(this.options.saveInLocal){
                localStorage.setItem(this.id,this.data);
            }

            let searchString = '';
            // 复原search参数
            paramKeys.forEach((key,index)=>{

                const appendShareSearch = !(key===constant.ID && simpleSteps.length===0);
                if(appendShareSearch) {
                    const appendInfo = paramObj[key]===undefined?'':('='+(paramObj[key]||''));
                    searchString = searchString + key +  appendInfo + '&'
                }
            });
            searchString = searchString?'?'+searchString:'';

            this.url  = location.protocol+"//"+location.host+location.pathname+searchString+location.hash;

            if(this.options.saveInURL){
                history.pushState(emptyString, constant.ID, this.url);
            }
            this.status = constant.SYNCED
            callback(storeData,this.url);
        }catch(e){
            this.status = constant.SYNCED_ERROR
            console.error(e)
            callback()
        }
    },1000);

    //TODO 滚动到此 自动展开 ，视线离开 自动收缩
    Object.defineProperty(this,"status",{get:()=>{return status},set:(value=>{
        const originStatus = status;
        if(originStatus===constant.DESTROY && value !== constant.RE_ALIVE){
            return;
        }
        status=value;
        if(status!==originStatus||status===constant.WAITING){
            CALLBACKFUN.forEach(fun=>{
                fun(value)
            })
        }
    })});
}

PagenoteCore.prototype.decodeData = function(data) {
    return decryptedData(data);
};
PagenoteCore.prototype.encryptData = function(data) {
    return encryptData(data)
};

PagenoteCore.prototype.CONSTANT = {
    ID:"pagenote",
    UN_INIT: -1,
    DESTROY: -9,
    RE_ALIVE: 99,
    WAITING:0,
    READY:1,
    RECORDING:2,
    PAUSE:3,
    RECORDED:4,
    REMOVED: -4,
    REMOVEDALL: -5,
    RECORDFAIL:5,
    FINNISHED:6,
    REPLAYING:7,
    PLAYANDWAIT:8,
    DONE:9,// 播放完毕
    START_SYNC:100, // 开始同步
    SYNCED:10, // 存储数据和内存对象已经同步
    SYNCED_ERROR: -10,

    URLCHANGED: 11,
    HASHCHANGED: 12,

    LIGHT: 100,
    DIS_LIGHT: -100,

    SHARE_CONFIRM: 'c',
    SHARE_ING:'i',
    SHARE_ERROR: 'e',
    SHARE_SUCCESS: 's',

    STORE_KEYS_VERSION_1:["x","y","id","text","tip","bg","time","isActive","offsetX","offsetY","parentW","pre","suffix"],
    STORE_KEYS_VERSION_2_VALIDATE:["x","y","id","text","tip","bg","time","isActive","offsetX","offsetY","parentW","pre","suffix"],
};

PagenoteCore.prototype.version = "4.0.3";
